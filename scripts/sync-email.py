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

THE RELEVANCE FILTER IS DETERMINISTIC AND LIVES HERE, not in the agent. Rules,
in order (the first that decides wins):
  1. Any CRM contact address in From/To/Cc          → stage. Noise filters do
     not apply: a known counterparty's mail is a thread, whatever the subject.
     (Scribe's own auto-reply check still ledgers their OOO robot.)
  2. Bulk-sender hints / noise subjects             → drop.
  3. One of us writing to anyone outside the team   → stage as OUTBOUND. This
     is the half that was invisible until INBOX.Sent was read: a human selling.
  4. Us writing to us (an internal forward)          → stage only if the body
     quotes a .gov or CRM address — i.e. it carries a live client thread.
  5. Unknown external sender                        → stage only on a .gov
     domain or a configured partner domain. There is no subject-keyword
     fallback: it admitted six SMUD expo marketing mails in one month.
Everything else never leaves the mailbox. An LLM filter would mean shipping
personal mail to a model to decide it was personal.

"Us" is OWN_DOMAINS plus TEAM_ADDRESSES — team members who write from an agency
address (@dmv.ca.gov) or a personal gmail were being treated as government
leads and queued as correspondents.

Idempotent by Message-ID, tracked in our own store — never by a mailbox flag,
because a flag would be a write.

Env:
  IMAP_HOST IMAP_PORT IMAP_USER IMAP_PASSWORD
  IMAP_SINCE_DAYS   (default 30; use a large number once for a backlog sweep)
  IMAP_FOLDERS      (default "INBOX,INBOX.Sent"; comma-separated — folder names
                     differ per server, check with an IMAP LIST if Sent is missed)
  TEAM_ADDRESSES    (comma-separated; replaces the built-in team list)
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
# belongs to someone ELSE. (novaerasol.com is the real NovaEra domain — the
# review queue holds two of its addresses; "novaerasolutions.com" never appeared.)
OWN_DOMAINS = {"4infinitesolutions.com", "infinitellm.ai", "infiniteai.com",
               "mybedrock.app", "novaerasol.com"}

# Team members who write from addresses outside our domains. Ganapathy and Rani
# work at DMV and mail from @dmv.ca.gov; two personal gmails also carry team
# traffic. Without this list they were "government domain dmv.ca.gov" leads and
# Pavan's own gmail was queued as a correspondent to add to the CRM.
DEFAULT_TEAM_ADDRESSES = {
    "ganapathy.murugesh@dmv.ca.gov",
    "rani.murugesh@dmv.ca.gov",
    "pavanmurugesh2002@gmail.com",
    "ganamuru@gmail.com",
}
TEAM_ADDRESSES = {
    a.strip().lower()
    for a in os.environ.get("TEAM_ADDRESSES", ",".join(DEFAULT_TEAM_ADDRESSES)).split(",")
    if a.strip()
}

# Third parties worth hearing from regardless of whether they are in the CRM yet.
# bidspro.com is our own product, not a partner — its mail is us.
PARTNER_DOMAINS = {
    "caleprocure.ca.gov", "fiscal.ca.gov", "dgs.ca.gov",
}

# Bulk senders that reach a business address constantly and never carry a real
# thread. Checked BEFORE the domain rules, because a vendor newsletter addressed to
# a .gov distribution list would otherwise sail through.
NOISE_HINTS = (
    "noreply", "no-reply", "donotreply", "notifications@", "marketing@",
    "newsletter", "@e.", "mailer", "bounce", "@go.", "@info.", "@news.",
)

NOISE_SUBJECTS = (
    "uptime check failure", "unsubscribe", "webinar", "livestream",
    "join us", "register now", "[action required] review",
)

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
GOV_ADDR_RE = re.compile(r"[\w.+-]+@[\w.-]+\.gov\b", re.I)


def _yaml_list_items(text: str, key: str) -> list[str]:
    """Values of a frontmatter list, in either YAML form:
         key:            key: [a, b]
           - a
           - b
    """
    m = re.search(rf"^{key}:[ \t]*(.*)$", text, re.M)
    if not m:
        return []
    inline = m.group(1).strip()
    if inline.startswith("["):
        return [v.strip().strip("'\"") for v in inline.strip("[]").split(",") if v.strip()]
    out = []
    # m.end() sits at the end of the key line; the first split chunk is that
    # line's (empty) remainder, so skip it.
    for line in text[m.end():].split("\n")[1:]:
        lm = re.match(r"^\s+-\s+(.+)$", line)
        if not lm:
            break
        out.append(lm.group(1).strip().strip("'\""))
    return out


def known_addresses() -> set[str]:
    """Every email in the CRM — primary `email:` plus `alt_emails:`. The store
    curates its own intake; linking an alt address to a contact once means
    their mail from it is a thread, not a review-queue question."""
    out = set()
    if not CONTACTS.exists():
        return out
    for f in CONTACTS.glob("*.md"):
        try:
            text = f.read_text(errors="replace")
        except Exception:
            continue
        m = re.search(r"^email:\s*(.+)$", text, re.M)
        if m:
            out.add(m.group(1).strip().strip("'\"").lower())
        for alt in _yaml_list_items(text, "alt_emails"):
            if "@" in alt:
                out.add(alt.lower())
    return out


def is_us(addr: str) -> bool:
    a = addr.lower()
    return a in TEAM_ADDRESSES or a.split("@")[-1] in OWN_DOMAINS


def is_noise_addr(addr: str) -> bool:
    return any(h in addr.lower() for h in NOISE_HINTS)


def is_relevant(addrs: list[str], known: set[str], subject: str,
                sender: str, body: str = "") -> tuple[bool, str]:
    """Decide whether a message leaves the mailbox. See the module docstring for
    the rule order; `addrs` is every From/To/Cc address, `sender` the raw From
    header, `body` the first text/plain part (already truncated)."""
    addrs = [a.lower() for a in addrs]
    sender_addr = (email.utils.parseaddr(sender or "")[1] or "").lower()
    if not sender_addr and addrs:
        sender_addr = addrs[0]

    # 1. A known counterparty anywhere on the message is a thread, full stop.
    for a in addrs:
        if a in known:
            return True, f"known contact {a}"

    # 2. Bulk mail never gets further.
    s = (sender or "").lower()
    subj = (subject or "").lower()
    if any(h in s for h in NOISE_HINTS):
        return False, ""
    if any(n in subj for n in NOISE_SUBJECTS):
        return False, ""

    others = [a for a in addrs if a != sender_addr]

    if is_us(sender_addr):
        # 3. One of us wrote to someone outside the team: outbound, and the
        #    only evidence of selling the mailbox holds.
        external = [a for a in others if not is_us(a) and not is_noise_addr(a)]
        if external:
            return True, f"outbound to {external[0]}"
        # 4. Us to us. Only an internal forward of a live client thread counts,
        #    and the body is the only place that shows.
        b = (body or "")[:4000].lower()
        gov = GOV_ADDR_RE.search(b)
        if gov:
            return True, f"internal forward quoting {gov.group(0).lower()}"
        for a in known:
            if a in b:
                return True, f"internal forward quoting {a}"
        return False, ""

    # 5. Unknown external sender: a government or partner domain, on the sender
    #    or on anyone else in the thread who is not us.
    for a in [sender_addr, *others]:
        if not a or is_us(a):
            continue
        dom = a.split("@")[-1]
        if dom.endswith(".gov"):
            return True, f"government domain {dom}"
        if dom in PARTNER_DOMAINS:
            return True, f"partner domain {dom}"
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
              "(and optionally IMAP_PORT, IMAP_SINCE_DAYS, IMAP_FOLDERS, TEAM_ADDRESSES).",
              file=sys.stderr)
        return 2

    port = int(os.environ.get("IMAP_PORT", "993"))
    since_days = int(os.environ.get("IMAP_SINCE_DAYS", "30"))
    folders = [f.strip() for f in os.environ.get("IMAP_FOLDERS", "INBOX,INBOX.Sent").split(",") if f.strip()]
    dry = "--dry" in sys.argv
    account = cfg["IMAP_USER"]

    known = known_addresses()
    print(f"filter: {len(known)} known CRM addresses + *.gov + {len(PARTNER_DOMAINS)} partner domains; "
          f"us = {len(OWN_DOMAINS)} domains + {len(TEAM_ADDRESSES)} team addresses")

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
                body = plain_body(msg)
                ok, why = is_relevant(addrs, known, decode_hdr(msg.get("Subject")),
                                      msg.get("From", ""), body)
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
                    "account": account,
                    "folder": folder,
                    "subject": decode_hdr(msg.get("Subject")),
                    "from": msg.get("From", ""),
                    "to": msg.get("To", ""),
                    "cc": msg.get("Cc", ""),
                    "addresses": addrs,
                    "matched": why,
                    "body": body,
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
