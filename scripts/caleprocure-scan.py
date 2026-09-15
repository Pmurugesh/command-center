#!/usr/bin/env python3
"""Daily Cal eProcure procurement scan — the API way.

Consumes qual_table_automations' proven discovery modules (client, parser,
relevance rules) from a read-only clone; this script adds NOTHING to how the
site is accessed — one request per run (the site's own Excel list export),
honest user agent, throttling, and the EPROCURE_ENABLED gate are all the
client's. Replaces the legacy browser-automation cron (disabled 2026-08-24
after six weeks of daily 600s timeouts; last real output 2026-07-14).

Output: intelligence/procurements/YYYY-MM-DD-caleprocure.md in the operations
repo, in the exact shape command-center's lib/procurements.ts parses (## 🔴/🟡
sections, "### <id> — <title>" blocks, bold field bullets, "**Score:** n/10").
The mini's operations janitor commits it; the dashboard reads it on next load.

Sidecar: YYYY-MM-DD-caleprocure.json beside it — EVERY open event with both
lens verdicts (see `sidecar_event`), written every run regardless of
--on-change. It exists because the consulting lens only runs here: the
qual_table clone lives on the mini, so `scripts/sync-leads.ts` (which scores
the product lens itself) reads this file to create Infinite Solutions leads.
The EDD Salesforce M&O RFP (7100-0000039456) scored 75 consulting / 0 product
and never became a lead until this file existed.

Flags:
  --on-change    the cron announces whatever this prints, every run. With this
                 flag the dated file is still written, but stdout carries the
                 shortlist only when an event id is new since the previous
                 dated file, so a day with nothing new sends nothing.

Environment:
  EPROCURE_ENABLED=true      required — set by the cron definition, never here
  QUAL_TABLE_BACKEND         qual_table backend dir
                             (default ~/repos/qual_table_automations/qual_table_app/backend)
  PROCUREMENTS_DIR           output dir
                             (default ~/repos/operations/intelligence/procurements)
  EPROCURE_FIXTURE_EXPORT    path to a captured list export — offline test mode,
                             no network at all
  EPROCURE_FIXTURE_NOW       ISO datetime used as "now" in fixture mode, so a
                             historical capture still has open events

Exit codes: 0 ok · 1 transport/parse failure · 2 gate off · 3 the site asked
us to stop (should_block) — do NOT re-enable without a human look.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND = Path(
    os.environ.get("QUAL_TABLE_BACKEND", "~/repos/qual_table_automations/qual_table_app/backend")
).expanduser()
sys.path.insert(0, str(BACKEND))

try:
    from app.core.eprocure_config import get_eprocure_config
    from app.services import eprocure_parser, eprocure_relevance
    from app.services import eprocure_discovery_service as svc
    from app.services.eprocure_client import EprocureTransportError, HttpEprocureClient
except ImportError as e:
    print(f"cannot import qual_table modules from {BACKEND}: {e}", file=sys.stderr)
    print("clone Pmurugesh/qual_table_automations there (read-only) or set QUAL_TABLE_BACKEND", file=sys.stderr)
    sys.exit(1)

PT = ZoneInfo("America/Los_Angeles")
# Sorting sentinel for rows with no parsed deadline: they sort last, not first.
FAR_FUTURE = datetime(9999, 1, 1, tzinfo=timezone.utc)
# Lens key → which of Pavan's entities that side of the business is.
ENTITY = {"consulting": "Infinite Solutions", "product": "InfiniteAI"}
LENSES = (eprocure_relevance.CONSULTING, eprocure_relevance.PRODUCT)
URGENT_DAYS = 7
ON_CHANGE = "--on-change" in sys.argv[1:]
# The "### <token> — <title>" heading every block starts with; ids are read
# back from the previous file with this, never from a side store.
HEADING_RE = re.compile(r"^### (\S+) — ", re.M)


def fetch_export() -> bytes:
    fixture = os.environ.get("EPROCURE_FIXTURE_EXPORT")
    if fixture:
        return Path(fixture).expanduser().read_bytes()
    cfg = get_eprocure_config()
    if not cfg.is_enabled:
        print("EPROCURE_ENABLED is not truthy — refusing to touch the network. "
              "The gate is deliberate (see qual_table's eprocure_config.py); "
              "set it in the cron definition.", file=sys.stderr)
        sys.exit(2)
    return HttpEprocureClient(cfg).fetch_list_export()


def now_utc() -> datetime:
    fixture_now = os.environ.get("EPROCURE_FIXTURE_NOW")
    if fixture_now:
        return datetime.fromisoformat(fixture_now)
    return datetime.now(timezone.utc)


def deadline_text(row) -> str:
    """MM/DD/YYYY H:MMAM PT — the shape lib/procurements.ts parseDeadline reads."""
    if row.end_date is None:
        return row.end_date_raw or "not listed"
    local = row.end_date.astimezone(PT)
    return local.strftime("%m/%d/%Y %I:%M%p PT").lstrip("0")


def event_token(row) -> str:
    """Single-token id for the '### <id> — <title>' heading. Event ids repeat
    across departments, so the pair is the identity (ListRow.key)."""
    return f"{row.department_code}-{row.event_id}".replace(" ", "")


def score_text(score) -> str:
    """The rules score on the 0-10 scale the dashboard reads.

    lib/procurements.ts parses "**Score:** n/10" and the Clock and Moves render
    and rank on that scale (a red badge at 8+). The relevance rules score
    0-100 in practice (v3: shortlist at 40, possible at 20, 80 the highest
    seen), so /10 maps them without inventing a second scale; anything above
    100 clips at 10 rather than reading as an 11."""
    return f"{min(10.0, round(score / 10, 1)):g}/10"


def block_for(row, verdicts, bucket) -> str:
    best = max(verdicts.values(), key=lambda v: v.score)
    entities = [ENTITY[k] for k, v in verdicts.items() if v.bucket == bucket] or [ENTITY[best.lens]]
    reasons = "; ".join(best.reasons[:3]) if best.reasons else "no individual rule fired"
    action_bits = [f"{best.lens} lens scored {best.score} ({reasons})"]
    if row.buyer_name or row.buyer_email:
        action_bits.append(f"buyer: {row.buyer_name} {row.buyer_email}".strip())
    lines = [
        f"### {event_token(row)} — {row.event_name}",
        f"- **Department:** {row.department_name} ({row.department_code})",
        f"- **Deadline:** {deadline_text(row)}",
        f"- **Score:** {score_text(best.score)}",
        f"- **Recommended entity:** {' / '.join(entities)}",
        f"- **Action:** {' · '.join(action_bits)}",
    ]
    return "\n".join(lines)


def sidecar_event(row, verdicts, rules_version) -> dict:
    """One open event as `scripts/sync-leads.ts` ingests it.

    `end_date` is the PACIFIC calendar date, not the UTC one: a 5:00 PM PT close
    is the next day in UTC, and the lead store keys expiry on date strings. The
    full instant is kept in `end_at` for anything that wants it. Only duck-typed
    attribute reads, so a fake row serialises the same way as a ListRow."""
    end = getattr(row, "end_date", None)
    return {
        "event_id": row.event_id,
        "business_unit": getattr(row, "business_unit", None) or row.department_code,
        "name": row.event_name,
        "department": getattr(row, "department_name", None),
        "end_date": end.astimezone(PT).strftime("%Y-%m-%d") if end else None,
        "end_at": end.isoformat() if end else None,
        "end_date_raw": getattr(row, "end_date_raw", None),
        "url": getattr(row, "url", None) or getattr(row, "event_url", None),
        "rules_version": rules_version,
        "lenses": {
            key: {"score": v.score, "bucket": v.bucket, "reasons": list(v.reasons or [])}
            for key, v in verdicts.items()
        },
    }


def previous_ids(out_dir: Path, today_path: Path):
    """Event tokens in the newest dated report before today's; None when there
    is no earlier report, so a first run announces everything."""
    prior = sorted(p for p in out_dir.glob("*-caleprocure.md") if p != today_path)
    if not prior:
        return None
    return set(HEADING_RE.findall(prior[-1].read_text(encoding="utf-8")))


def sort_key(item):
    row, _verdicts, best_score = item
    return (row.end_date or FAR_FUTURE, -best_score)


def main() -> int:
    now = now_utc()
    raw = fetch_export()
    rows = eprocure_parser.parse_list_export(raw)
    drift = eprocure_parser.check_export_shape(rows)
    open_rows = [r for r in rows if not svc.is_closed(svc.to_record(r), now=now)]

    shortlisted = {"likely": [], "possible": []}
    sidecar = []
    for row in open_rows:
        verdicts = {lens.key: eprocure_relevance.score_list_row(row, lens) for lens in LENSES}
        sidecar.append(sidecar_event(row, verdicts, eprocure_relevance.RELEVANCE_VERSION))
        bucket = eprocure_relevance.best_bucket(v.bucket for v in verdicts.values())
        if bucket in shortlisted:
            best_score = max(v.score for v in verdicts.values())
            shortlisted[bucket].append((row, verdicts, best_score))
    for items in shortlisted.values():
        items.sort(key=sort_key)

    today_pt = now.astimezone(PT)
    urgent = [
        (row, verdicts)
        for row, verdicts, _ in shortlisted["likely"]
        if row.end_date and (row.end_date - now).days < URGENT_DAYS
    ]

    out = [f"# CaleProcure Daily Scan — {today_pt.strftime('%Y-%m-%d')}", ""]
    out.append(
        f"Source: {len(rows)} posted events from the suppliers.fiscal.ca.gov list export "
        f"({len(open_rows)} open), scored by qual_table_automations' deterministic relevance "
        f"rules v{eprocure_relevance.RELEVANCE_VERSION} (provisional: list-level, no commodity "
        f"codes). One network request per run."
    )
    out.append("")

    out.append("## 🔴 High Relevance (shortlist — rules score ≥ 40)")
    out.append("")
    if shortlisted["likely"]:
        for row, verdicts, _ in shortlisted["likely"]:
            out.append(block_for(row, verdicts, "likely"))
            out.append("")
    else:
        out.append("Nothing on the shortlist today.")
        out.append("")

    out.append("## 🟡 Medium Relevance (possible — rules score ≥ 20)")
    out.append("")
    if shortlisted["possible"]:
        for row, verdicts, _ in shortlisted["possible"]:
            out.append(block_for(row, verdicts, "possible"))
            out.append("")
    else:
        out.append("Nothing in the possible band today.")
        out.append("")

    out.append("## 📊 Summary")
    out.append("")
    out.append(f"- Events in export: {len(rows)} · open: {len(open_rows)}")
    out.append(f"- High: {len(shortlisted['likely'])} · Medium: {len(shortlisted['possible'])}")
    if drift:
        out.append(f"- ⚠️ Export format drift: {'; '.join(drift)}")
    out.append("")

    out.append(f"## ⚠️ Urgent (deadline within {URGENT_DAYS} days)")
    out.append("")
    if urgent:
        for row, _verdicts in urgent:
            out.append(f"- {event_token(row)} — {row.event_name} · due {deadline_text(row)}")
    else:
        out.append("No shortlisted events closing this week.")
    out.append("")

    out_dir = Path(
        os.environ.get("PROCUREMENTS_DIR", "~/repos/operations/intelligence/procurements")
    ).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{today_pt.strftime('%Y-%m-%d')}-caleprocure.md"
    seen_before = previous_ids(out_dir, out_path)
    out_path.write_text("\n".join(out), encoding="utf-8")
    out_path.with_suffix(".json").write_text(
        json.dumps(sidecar, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    if ON_CHANGE:
        listed = [(band, row) for band, items in shortlisted.items() for row, _v, _s in items]
        new = [(band, row) for band, row in listed
               if seen_before is None or event_token(row) not in seen_before]
        if not new:
            return 0   # nothing new since the last file: empty stdout, no announce
        print(f"{len(new)} new since the previous scan:")
        for band, row in new:
            marker = "🔴" if band == "likely" else "🟡"
            print(f"{marker} {event_token(row)} — {row.event_name} · due {deadline_text(row)}")
    print(f"{out_path}: {len(shortlisted['likely'])} high, {len(shortlisted['possible'])} medium, "
          f"{len(urgent)} urgent of {len(open_rows)} open events")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except EprocureTransportError as e:
        if getattr(e, "should_block", False):
            print(f"SITE ASKED US TO STOP: {e} — do not re-enable without a human look", file=sys.stderr)
            sys.exit(3)
        print(f"transport error: {e}", file=sys.stderr)
        sys.exit(1)
    except eprocure_parser.EprocureParseError as e:
        print(f"parse error (export format may have shifted): {e}", file=sys.stderr)
        sys.exit(1)
