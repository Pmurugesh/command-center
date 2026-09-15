# Sending a draft from the dashboard

Wave 3, decision 1 (2026-09-14). The dashboard may send a verified follow-up
draft on your explicit per-draft yes. The amended RED-LINES rule 3: a send
happens only on that yes, is executed by the dashboard's send route, and is
logged with `via dashboard` or `via pavan-telegram`. No agent sends on its own.

## Setup: nothing

Mail goes out from the same mailbox the intake sync reads,
`pavanm@4infinitesolutions.com` on `mail.4infinitesolutions.com`, using the
credentials already in `~/.config/command-center/mail.env` on the mini
(`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`). `scripts/send-mail.py` derives
its SMTP settings from those: host = `IMAP_HOST`, user and From address =
`IMAP_USER`, password = `IMAP_PASSWORD`, port 465 with implicit TLS. There is no
second credentials file and no app password to create.

If that file exists, the Outreach page shows a Send button on every draft
marked ready. If it does not, the button is absent and the route answers
`503 sending not configured`.

Optional lines you can add to `mail.env` (none required):

```
SMTP_PORT=587            # use STARTTLS on 587 instead of implicit TLS on 465
SMTP_HOST=...            # only if sending goes through a different host
SMTP_FROM_NAME=Pavan Murugesh
SEND_BCC=crm@4infinitesolutions.com   # decision 2: the shared address; empty until you set it
SENT_FOLDER=INBOX.Sent   # where the sent copy is appended (this is the default)
```

## Prove the path once

On the mini, from `~/repos/command-center`:

```
python3 scripts/send-mail.py --test pavanm@4infinitesolutions.com --dry-run   # prints the message, connects to nothing
python3 scripts/send-mail.py --test pavanm@4infinitesolutions.com             # sends one line to yourself
```

The second command exits 0 and prints the Message-ID as its last line. Check
two things: the message arrived, and a copy sits in the Sent folder (the
script APPENDs it there over IMAP after the SMTP send). Within fifteen minutes
the email-sync tick reads that Sent copy and files it as an outbound touch,
the same way it files mail you send from Outlook. That is deliberate: a
dashboard send and a hand send look identical to intake.

A non-zero exit prints one line on stderr saying why (`SMTP authentication
failed for ...`, `SMTP connection to host:port failed: ...`). The password is
never printed.

## What a send does

`POST /api/crm/drafts/<slug>/send` with body `{"confirm": "<slug>"}` (the slug
repeated is the yes; `"via": "pavan-telegram"` records a yes relayed from
Telegram). The route refuses, with a reason, unless all of these hold:

- the draft exists and is still `status: draft`
- it is marked `ready: true` (a human or Capture read it and said it is fit to send)
- its `to` is the contact's `email` or one of their `alt_emails`
- `findInternalLeaks` finds nothing: no `next_action` or `blocked_on` text, no
  repo path, no template tell
- neither subject nor body contains an em-dash (USER.md rule)
- `mail.env` exists on this machine

The body goes out exactly as stored; nothing is interpolated at send time. On
success the draft becomes `status: sent` with `sent_via: send-route`, the
`message_id` and `sent_by`, the contact gets the log line
`Sent follow-up email: <subject>` and next action "Await reply; chase if
silent" due in ten days. A failed SMTP call leaves the draft untouched and
returns 502 with the script's reason.

"Mark sent" on the Outreach page remains for mail you sent from your own
client; it logs `via outreach` and does not touch the mailbox.

## Telegram

The morning digest now asks for `yes <slug>` to send a draft, `no <slug> <why>`,
`later <slug> <date>`, or `sent <slug>` only when you sent it yourself. The
agent turns `yes <slug>` into the POST above with `"via": "pavan-telegram"`;
that wiring lands with the operations-side workflow change.
