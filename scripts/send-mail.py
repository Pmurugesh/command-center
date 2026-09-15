#!/usr/bin/env python3
"""
Send one plain-text email from the mailbox the intake sync already reads.
Stdlib only (smtplib, imaplib, ssl, email).

This is the only thing in the system that sends mail, and it is only ever
invoked by the dashboard's send route (POST /api/crm/drafts/<slug>/send)
after that route has verified the draft and received Pavan's explicit
per-draft yes. It knows nothing about drafts or contacts: it is handed a
recipient, a subject and a body file and sends exactly that.

Config: ~/.config/command-center/mail.env — the same file, same KEY=VALUE
convention, that scripts/mini/install-email-sync.sh sources for the IMAP
reader. Nothing new is required; sending derives from the reader's values:
  SMTP_HOST      default IMAP_HOST
  SMTP_PORT      default 465 (implicit TLS); 587 uses STARTTLS
  SMTP_USER      default IMAP_USER — also the From address
  SMTP_PASSWORD  default IMAP_PASSWORD
  SMTP_FROM_NAME optional display name
  SEND_BCC       optional, comma-separated (crm@ so the team's intake sees it)
  SENT_FOLDER    default INBOX.Sent — where the sent copy is appended
  IMAP_PORT      default 993, for that append
A value already in the process environment overrides the file (so a caller
that `set -a; source mail.env`'d first behaves the same).

After a successful send the message is APPENDed to SENT_FOLDER over IMAP, so
the next sync-email.py tick files it as an outbound touch with no special
casing. An append failure is reported on stderr but is not a send failure:
the mail has left.

Usage:
  send-mail.py --to a@b.c --subject "..." --body-file path
               [--reply-to x@y] [--in-reply-to '<msg-id>'] [--dry-run]
  send-mail.py --test a@b.c          one-line message to prove the path
  send-mail.py --test a@b.c --dry-run

Prints the Message-ID as the LAST line of stdout. --dry-run prints the RFC822
message instead of connecting, then that same last line, and exits 0.

Exit codes: 0 sent, 1 SMTP failure (one-line reason on stderr), 2 bad usage
or missing config. The password is never printed, in any branch.
"""
import argparse
import imaplib
import os
import smtplib
import ssl
import sys
import time
from typing import NoReturn
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

CONFIG_PATH = os.path.expanduser("~/.config/command-center/mail.env")
KNOWN_KEYS = (
    "IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASSWORD",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_NAME",
    "SEND_BCC", "SENT_FOLDER",
)


def fail(code: int, reason: str) -> NoReturn:
    print(reason, file=sys.stderr)
    sys.exit(code)


def read_env_file(path: str) -> dict:
    """KEY=VALUE lines as `set -a; source` would read them: comments, blank
    lines and an `export` prefix ignored, matching surrounding quotes dropped."""
    out = {}
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            out[key] = value
    return out


def load_config(path: str) -> dict:
    if not os.path.isfile(path):
        fail(2, f"sending not configured: {path} is missing")
    cfg = read_env_file(path)
    for key in KNOWN_KEYS:
        if os.environ.get(key):
            cfg[key] = os.environ[key]

    host = cfg.get("SMTP_HOST") or cfg.get("IMAP_HOST", "")
    user = cfg.get("SMTP_USER") or cfg.get("IMAP_USER", "")
    password = cfg.get("SMTP_PASSWORD") or cfg.get("IMAP_PASSWORD", "")
    if not host:
        fail(2, f"sending not configured: neither SMTP_HOST nor IMAP_HOST in {path}")
    if not user:
        fail(2, f"sending not configured: neither SMTP_USER nor IMAP_USER in {path}")
    try:
        smtp_port = int(cfg.get("SMTP_PORT") or "465")
        imap_port = int(cfg.get("IMAP_PORT") or "993")
    except ValueError:
        fail(2, "SMTP_PORT / IMAP_PORT must be numbers")

    return {
        "smtp_host": host,
        "smtp_port": smtp_port,
        "user": user,
        "password": password,
        "from_name": (cfg.get("SMTP_FROM_NAME") or "").strip(),
        "bcc": [a.strip() for a in (cfg.get("SEND_BCC") or "").split(",") if a.strip()],
        "imap_host": cfg.get("IMAP_HOST") or host,
        "imap_port": imap_port,
        "sent_folder": cfg.get("SENT_FOLDER") or "INBOX.Sent",
    }


def build_message(cfg: dict, to: str, subject: str, body: str, reply_to=None, in_reply_to=None) -> EmailMessage:
    """The message as the recipient will see it. Bcc is an envelope matter and
    is deliberately NOT a header here, so it never reaches the recipient."""
    msg = EmailMessage()
    msg["From"] = formataddr((cfg["from_name"], cfg["user"])) if cfg["from_name"] else cfg["user"]
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    domain = cfg["user"].rsplit("@", 1)[-1] if "@" in cfg["user"] else None
    msg["Message-ID"] = make_msgid(idstring="send-route", domain=domain)
    if reply_to:
        msg["Reply-To"] = reply_to
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body, subtype="plain", charset="utf-8")
    return msg


def smtp_send(cfg: dict, msg: EmailMessage, recipients: list) -> None:
    host, port = cfg["smtp_host"], cfg["smtp_port"]
    context = ssl.create_default_context()
    try:
        if port == 587:
            smtp = smtplib.SMTP(host, port, timeout=30)
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        else:
            smtp = smtplib.SMTP_SSL(host, port, timeout=30, context=context)
        with smtp:
            smtp.login(cfg["user"], cfg["password"])
            refused = smtp.send_message(msg, from_addr=cfg["user"], to_addrs=recipients)
        if refused:
            fail(1, "SMTP refused recipient(s): " + ", ".join(sorted(refused)))
    except smtplib.SMTPAuthenticationError as e:
        # First line of the server's reason only; the credentials are never in it.
        detail = e.smtp_error.decode("utf-8", "replace").splitlines()[0] if e.smtp_error else ""
        fail(1, f"SMTP authentication failed for {cfg['user']} ({e.smtp_code}): {detail}".strip())
    except smtplib.SMTPException as e:
        fail(1, f"SMTP error: {str(e).splitlines()[0] if str(e) else type(e).__name__}")
    except OSError as e:
        fail(1, f"SMTP connection to {host}:{port} failed: {e.strerror or e}")


def imap_append_sent(cfg: dict, msg: EmailMessage) -> str:
    """Copy the sent message into the Sent folder. Returns '' or a warning."""
    try:
        with imaplib.IMAP4_SSL(cfg["imap_host"], cfg["imap_port"], timeout=30) as imap:
            imap.login(cfg["user"], cfg["password"])
            status, _ = imap.append(
                cfg["sent_folder"], "\\Seen", imaplib.Time2Internaldate(time.time()), msg.as_bytes(),
            )
            if status != "OK":
                return f"IMAP append to {cfg['sent_folder']} returned {status}"
        return ""
    except (imaplib.IMAP4.error, OSError) as e:
        return f"IMAP append to {cfg['sent_folder']} failed: {str(e).splitlines()[0] if str(e) else type(e).__name__}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Send one plain-text email from the intake mailbox.")
    ap.add_argument("--to")
    ap.add_argument("--subject")
    ap.add_argument("--body-file")
    ap.add_argument("--reply-to")
    ap.add_argument("--in-reply-to", metavar="MESSAGE-ID")
    ap.add_argument("--test", metavar="ADDRESS", help="send a one-line test message to ADDRESS")
    ap.add_argument("--dry-run", "--dry", dest="dry_run", action="store_true",
                    help="print the message, do not connect")
    args = ap.parse_args()

    if args.test:
        if args.to or args.subject or args.body_file:
            ap.error("--test takes no --to/--subject/--body-file")
        to, subject = args.test, "send-route test"
        body = f"Test message from scripts/send-mail.py at {formatdate(localtime=True)}.\n"
    else:
        if not (args.to and args.subject and args.body_file):
            ap.error("--to, --subject and --body-file are required (or use --test ADDRESS)")
        to, subject = args.to, args.subject
        try:
            with open(args.body_file, encoding="utf-8") as fh:
                body = fh.read()
        except OSError as e:
            fail(2, f"cannot read body file: {e.strerror}")

    cfg = load_config(CONFIG_PATH)
    msg = build_message(cfg, to, subject, body, args.reply_to, args.in_reply_to)
    message_id = msg["Message-ID"]
    recipients = [to] + cfg["bcc"]

    if args.dry_run:
        print(msg.as_string())
        print(f"(envelope recipients: {', '.join(recipients)}; sent copy -> {cfg['sent_folder']})")
        print(message_id)
        return 0

    if not cfg["password"]:
        fail(2, f"sending not configured: neither SMTP_PASSWORD nor IMAP_PASSWORD in {CONFIG_PATH}")

    smtp_send(cfg, msg, recipients)
    warning = imap_append_sent(cfg, msg)
    if warning:
        print(f"warning: sent, but {warning}", file=sys.stderr)
    print(message_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
