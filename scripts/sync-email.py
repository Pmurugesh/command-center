#!/usr/bin/env python3
"""
Email intake connector — Layer 1 of the Scribe design.

STRICTLY READ-ONLY AGAINST THE MAILBOX, and that is enforced by protocol choice,
not by discipline:
  * fetches with BODY.PEEK[] — a plain BODY[] fetch sets the \\Seen flag and would
    silently mark your mail as read. PEEK does not.
  * never issues STORE, EXPUNGE, COPY, or DELETE.
  * never opens SMTP. This process cannot send.
  * opens the mailbox with readonly=True, so the server itself refuses mutations.

WHY PYTHON, when the rest of the pipeline is TypeScript: imaplib and email are
standard library, so the connector adds zero dependencies to the dashboard. Layer
1 is deliberately language-agnostic — it stages files, and the TypeScript side
reads them. That was the point of making files the bus.

THE RELEVANCE FILTER IS DETERMINISTIC AND LIVES HERE, not in the agent. Only mail
touching a known CRM contact address, a *.ca.gov / *.gov domain, or a configured
partner domain is staged at all. Everything else never leaves the mailbox. Granola
showed 1 of 5 meetings was even business-relevant; a mailbox is far worse, and an
LLM filter would mean shipping personal mail to a model to decide it was personal.

Idempotent by Message-ID, tracked in our own store — never by a mailbox flag,
because a flag would be a write.

Env:
  IMAP_HOST IMAP_PORT IMAP_USER IMAP_PASSWORD
  IMAP_SINCE_DAYS   (default 30; use a large number once for a backlog sweep)
  IMAP_FOLDERS      (default "INBOX"; comma-separated, e.g. "INBOX,Sent")
"""
import email
import email.header
import email.utils
import hashlib
import imaplib
import json
import os
import pathlib
import re
import sys
from datetime import datetime, timedelta

HOME = pathlib.Path.home()
OPS = HOME / "repos/operations"
INTAKE = OPS / "crm/intake/email"
CONTACTS = OPS / "crm/contacts"

# OUR OWN domains. Deliberately NOT relevance signals: every message in the
# mailbox carries one of these in From, To or Cc, so treating them as a signal
# matched 58 of 60 messages on the first dry run — newsletters, uptime alerts and
# Microsoft marketing all "matched". An address only counts toward relevance if it
# belongs to someone ELSE.
OWN_DOMAINS = {"4infinitesolutions.com", "infinitellm.ai", "infiniteai.com",
               "mybedrock.app", "novaerasolutions.com"}

# Third parties worth hearing from regardless of whether they are in the CRM yet.
PARTNER_DOMAINS = {
    "caleprocure.ca.gov", "fiscal.ca.gov", "dgs.ca.gov", "bidspro.com",
}

# Bulk senders that reach a business address constantly and never carry a real
# thread. Checked BEFORE the allow rules, because a vendor newsletter addressed to
# a .gov distribution list would otherwise sail through.
NOISE_HINTS = (
    "noreply", "no-reply", "donotreply", "notifications@", "marketing@",
    "newsletter", "@e.", "mailer", "bounce", "@go.", "@info.", "@news.",
)
# Subject-line evidence that a message is about the BUSINESS, whoever it is from.
# Needed because relevant mail is not always from a .gov counterparty: internal
# threads ("ISI Internal Daily for CSJ CRM") and non-.gov public bodies (SMUD,
# BidsPro) were both filtered out when domain was the only test. A mailbox of ~60
# messages a month can afford recall; the cost of a miss is a lost thread, the
# cost of a false positive is one row a human skips.
SUBJECT_SIGNALS = (
    "rfp", "rfi", "rfo", "bid", "solicitation", "proposal", "procurement",
    "sow", "statement of work", "amendment", "task order", "msa", "cmas",
    "demo", "poc", "pilot", "contract", "award", "quote", "sole source",
    "meet the buyers", "vendor", "supplier", "addendum", "intent to award",
)

NOISE_SUBJECTS = (
    "uptime check failure", "unsubscribe", "webinar", "livestream",
    "join us", "register now", "[action required] review",
)


def known_addresses() -> set[str]:
    """Every email in the CRM. The store curates its own intake."""
    out = set()
    if not CONTACTS.exists():
        return out
    for f in CONTACTS.glob("*.md"):
        try:
            m = re.search(r"^email:\s*(.+)$", f.read_text(errors="replace"), re.M)
            if m:
                out.add(m.group(1).strip().strip("'\"").lower())
        except Exception:
            continue
    return out


def is_relevant(addrs: list[str], known: set[str], subject: str,
                sender: str) -> tuple[bool, str]:
    """Relevance requires a counterparty who is not us.

    Order matters: noise is rejected before the allow rules, so a vendor blast
    addressed to a government distribution list cannot slip through on the
    strength of the recipient's domain.
    """
    s = (sender or "").lower()
    subj = (subject or "").lower()
    if any(h in s for h in NOISE_HINTS):
        return False, ""
    if any(n in subj for n in NOISE_SUBJECTS):
        return False, ""

    for a in addrs:
        a = a.lower()
        dom = a.split("@")[-1]
        if dom in OWN_DOMAINS:
            continue                      # us, not a counterparty
        if a in known:
            return True, f"known contact {a}"
        if dom.endswith(".ca.gov") or dom.endswith(".gov"):
            return True, f"government domain {dom}"
        if dom in PARTNER_DOMAINS:
            return True, f"partner domain {dom}"

    # No external counterparty matched — fall back to what the subject says it
    # is about. This is what recovers internal threads and non-.gov public bodies.
    for sig in SUBJECT_SIGNALS:
        if re.search(rf"\b{re.escape(sig)}\b", subj):
            return True, f"subject signal: {sig}"
    return False, ""


def decode_hdr(v) -> str:
    """RFC 2047 subjects arrive as =?UTF-8?Q?...?= — decode before use, since
    both the human reading the output and the noise filter need real words."""
    if not v:
        return ""
    try:
        parts = email.header.decode_header(v)
        return "".join(
            (b.decode(enc or "utf-8", errors="replace") if isinstance(b, bytes) else b)
            for b, enc in parts
        ).strip()
    except Exception:
        return str(v).strip()


def header_addrs(msg) -> list[str]:
    out = []
    for h in ("From", "To", "Cc"):
        v = msg.get(h, "")
        for _, addr in email.utils.getaddresses([v]):
            if addr:
                out.append(addr)
    return out


def plain_body(msg, limit=4000) -> str:
    """First text/plain part, truncated. Bodies are evidence, not archives."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(
                part.get("Content-Disposition", "")
            ):
                try:
                    return part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace"
                    )[:limit]
                except Exception:
                    continue
        return ""
    try:
        return msg.get_payload(decode=True).decode(
            msg.get_content_charset() or "utf-8", errors="replace"
        )[:limit]
    except Exception:
        return ""


def main() -> int:
    cfg = {k: os.environ.get(k, "") for k in
           ("IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD")}
    if not all(cfg.values()):
        print("Not configured. Set IMAP_HOST, IMAP_USER, IMAP_PASSWORD "
              "(and optionally IMAP_PORT, IMAP_SINCE_DAYS, IMAP_FOLDERS).",
              file=sys.stderr)
        return 2

    port = int(os.environ.get("IMAP_PORT", "993"))
    since_days = int(os.environ.get("IMAP_SINCE_DAYS", "30"))
    folders = [f.strip() for f in os.environ.get("IMAP_FOLDERS", "INBOX").split(",") if f.strip()]
    dry = "--dry" in sys.argv

    known = known_addresses()
    print(f"filter: {len(known)} known CRM addresses + *.gov + {len(PARTNER_DOMAINS)} partner domains")

    INTAKE.mkdir(parents=True, exist_ok=True)
    seen_ids = {p.stem for p in INTAKE.glob("*.json")}

    since = (datetime.now() - timedelta(days=since_days)).strftime("%d-%b-%Y")
    M = imaplib.IMAP4_SSL(cfg["IMAP_HOST"], port)
    try:
        M.login(cfg["IMAP_USER"], cfg["IMAP_PASSWORD"])
    except imaplib.IMAP4.error as e:
        print(f"login failed: {e}", file=sys.stderr)
        return 1

    staged = skipped_irrelevant = skipped_seen = 0
    try:
        for folder in folders:
            # readonly=True: the SERVER refuses any mutation on this session.
            typ, _ = M.select(f'"{folder}"', readonly=True)
            if typ != "OK":
                print(f"  ! cannot open folder {folder}")
                continue
            typ, data = M.search(None, f'(SINCE {since})')
            ids = data[0].split() if typ == "OK" and data and data[0] else []
            print(f"{folder}: {len(ids)} messages since {since}")

            for num in ids:
                # PEEK is the read-only guarantee — a plain BODY[] would mark it read.
                typ, mdata = M.fetch(num, "(BODY.PEEK[])")
                if typ != "OK" or not mdata or not isinstance(mdata[0], tuple):
                    continue
                msg = email.message_from_bytes(mdata[0][1])

                mid = (msg.get("Message-ID") or "").strip()
                key = hashlib.sha1((mid or str(mdata[0][1][:200])).encode()).hexdigest()[:20]
                if key in seen_ids:
                    skipped_seen += 1
                    continue

                addrs = header_addrs(msg)
                ok, why = is_relevant(addrs, known, msg.get("Subject", ""),
                                      msg.get("From", ""))
                if not ok:
                    skipped_irrelevant += 1
                    continue

                date_hdr = msg.get("Date", "")
                try:
                    dt = email.utils.parsedate_to_datetime(date_hdr)
                    iso = dt.date().isoformat()
                except Exception:
                    iso = ""

                rec = {
                    "message_id": mid,
                    "date": iso,
                    "folder": folder,
                    "subject": decode_hdr(msg.get("Subject")),
                    "from": msg.get("From", ""),
                    "to": msg.get("To", ""),
                    "cc": msg.get("Cc", ""),
                    "addresses": addrs,
                    "matched": why,
                    "body": plain_body(msg),
                    "staged_at": datetime.now().isoformat(timespec="seconds"),
                }
                if dry:
                    print(f"  + [{iso}] {rec['subject'][:62]:64s} {why}")
                else:
                    (INTAKE / f"{key}.json").write_text(json.dumps(rec, indent=1))
                staged += 1
    finally:
        try:
            M.close()
        except Exception:
            pass
        M.logout()

    print(f"\n{'[dry] would stage' if dry else 'staged'}: {staged}   "
          f"already seen: {skipped_seen}   filtered out: {skipped_irrelevant}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
