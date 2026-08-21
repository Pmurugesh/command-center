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

PARTNER_DOMAINS = {
    "4infinitesolutions.com", "infinitellm.ai", "novaerasolutions.com",
    "caleprocure.ca.gov", "fiscal.ca.gov", "dgs.ca.gov",
}


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


def is_relevant(addrs: list[str], known: set[str]) -> tuple[bool, str]:
    for a in addrs:
        a = a.lower()
        if a in known:
            return True, f"known contact {a}"
        dom = a.split("@")[-1]
        if dom.endswith(".ca.gov") or dom.endswith(".gov"):
            return True, f"government domain {dom}"
        if dom in PARTNER_DOMAINS:
            return True, f"partner domain {dom}"
    return False, ""


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
                ok, why = is_relevant(addrs, known)
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
                    "subject": (msg.get("Subject") or "").strip(),
                    "from": msg.get("From", ""),
                    "to": msg.get("To", ""),
                    "cc": msg.get("Cc", ""),
                    "addresses": addrs,
                    "matched": why,
                    "body": plain_body(msg),
                    "staged_at": datetime.now().isoformat(timespec="seconds"),
                }
                if dry:
                    print(f"  + [{iso}] {rec['subject'][:62]}  ({why})")
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
