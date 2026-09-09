/**
 * One definition of "what day is it", because there are two right answers and
 * picking the wrong one is invisible for seventeen hours a day.
 *
 * `new Date().toISOString().slice(0, 10)` is the obvious way to get today as
 * `YYYY-MM-DD` and it is **wrong on this machine from 17:00 until midnight** —
 * seven hours, 29% of the day — because PDT is UTC-7 and the UTC date has
 * already rolled over. It fails only in the evening, which is when this system
 * is most used, and it fails silently: a stamp one day in the future looks like
 * a stamp.
 *
 * It has already cost us. `resolveDecision` wrote
 * `[RESOLVED 2026-09-09]` into `roadmap/steward-sanjose-outcome.md` from a
 * commit made at 18:04 local on 2026-09-08. Earlier the same day I hand-fixed
 * four files that had picked up tomorrow's date and recorded it as my own
 * mistake, which it was not — it was this.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * **"What day is it now" → local.** Use `localToday()`. Anything a human will
 * read as the day something happened: a resolution stamp, `last_touched`, a
 * `publishedAt`, the cutoff for "the last 90 days".
 *
 * **"Round-trip a date-only value" → UTC.** Do NOT use this function. A bare
 * `2026-09-08`, whether from YAML or `new Date(str)`, is parsed as UTC
 * midnight; reading local components off it gives you 2026-09-07 in any
 * negative-offset zone. `toDateStr()` in `gtm.ts` and `weekOf()` in
 * `content.ts` both do this correctly today and must stay on UTC. The two
 * cases look identical and are opposites.
 */

/** Today as `YYYY-MM-DD` in the machine's own timezone. */
export function localToday(now: Date = new Date()): string {
  return localDate(now)
}

/** Any Date as `YYYY-MM-DD` in the machine's own timezone. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `YYYY-MM-DD` for `days` ago, local — the honest form of a lookback window. */
export function localDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return localDate(d)
}

/**
 * The local calendar day an instant fell on, for display.
 *
 * `generated_at` and friends are stored as UTC ISO instants, which is correct —
 * an instant should be unambiguous. But slicing the first ten characters of one
 * shows the UTC day, so `/roadmap`'s staleness banner printed
 * "Last run 2026-09-09" for a check that ran at 18:10 on 2026-09-08. A date in
 * the future, on screen, above a board about being honest.
 *
 * Storage stays UTC. Only the reading is local.
 */
export function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso.slice(0, 10) : localDate(d)
}

