/**
 * How long may pass between two firings of a cron expression?
 *
 * The heartbeat needs an expectation to compare a pipeline's last run against,
 * and hardcoding one per job guarantees drift: someone edits the schedule and
 * the expectation quietly becomes a lie. So the expectation is DERIVED from the
 * live schedule instead.
 *
 * Deliberately answers "max gap", not "next run". `0 8 * * 1-5` fires daily but
 * its real gap is 72 hours across a weekend, and a heartbeat that alarms every
 * Monday at 09:00 is one that gets muted. Wednesdays-only jobs (the misnamed
 * `daily-intel-scan`) are 168 hours and equally fine.
 *
 * A deliberately small parser: five space-separated fields, `*`, lists, ranges
 * and steps. No `@daily`, no `L`/`W`/`#`, no seconds field. Anything it cannot
 * parse returns null, and the caller falls back to a declared expectation
 * rather than guessing — an unreadable schedule must never render as "healthy".
 */

/** Expand one cron field into the set of values it matches. */
function expand(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) return null

    let lo: number, hi: number
    if (range === '*') {
      lo = min; hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null
      lo = a; hi = b
    } else {
      const v = Number(range)
      if (!Number.isInteger(v)) return null
      // A bare value with a step means "from here to the end" (`5/2`).
      lo = v; hi = stepRaw === undefined ? v : max
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size ? out : null
}

export interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  /** True when day-of-month and day-of-week are BOTH restricted — cron ORs them. */
  domAndDowBothSet: boolean
}

export function parseCron(expr: string): CronFields | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const minute = expand(f[0], 0, 59)
  const hour = expand(f[1], 0, 23)
  const dom = expand(f[2], 1, 31)
  const month = expand(f[3], 1, 12)
  // 7 is Sunday in most crons; normalise it to 0.
  const dowRaw = expand(f[4], 0, 7)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  const dow = new Set(Array.from(dowRaw).map(d => (d === 7 ? 0 : d)))
  return {
    minute, hour, dom, month, dow,
    domAndDowBothSet: f[2] !== '*' && f[4] !== '*',
  }
}

/** Does `d` (local time) match the expression? */
export function matches(c: CronFields, d: Date): boolean {
  if (!c.minute.has(d.getMinutes())) return false
  if (!c.hour.has(d.getHours())) return false
  if (!c.month.has(d.getMonth() + 1)) return false
  // Standard cron quirk: when BOTH day fields are restricted the job fires if
  // EITHER matches, not both. Getting this backwards would silently narrow the
  // expected cadence and produce false "late" alarms.
  const dom = c.dom.has(d.getDate())
  const dow = c.dow.has(d.getDay())
  return c.domAndDowBothSet ? dom || dow : dom && dow
}

/**
 * The longest gap in hours between consecutive firings, sampled over `days`
 * from `from`. Null when the expression will not parse or never fires in the
 * window — both mean "no expectation can be derived", never "fine".
 *
 * Minute resolution would be 40,320 iterations for a 4-week window; hour
 * resolution is 672 and is enough, because every schedule this watches fires on
 * the hour. Sub-hourly jobs collapse to a 1-hour gap, which is the right answer
 * for a staleness check anyway.
 */
export function maxGapHours(expr: string, from: Date = new Date(), days = 28): number | null {
  const c = parseCron(expr)
  if (!c) return null

  const hits: number[] = []
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0)
  for (let h = 0; h < days * 24; h++) {
    const t = new Date(start.getTime() + h * 3_600_000)
    // Any minute in this hour firing makes the hour a hit.
    let fires = false
    for (const m of Array.from(c.minute)) {
      const at = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), m)
      if (matches(c, at)) { fires = true; break }
    }
    if (fires) hits.push(h)
  }
  if (hits.length < 2) return null

  let gap = 0
  for (let i = 1; i < hits.length; i++) gap = Math.max(gap, hits[i] - hits[i - 1])
  return gap || 1
}
