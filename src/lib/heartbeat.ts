/**
 * Is every pipeline that feeds this dashboard still running?
 *
 * `/roadmap` already says "Last run X — over N days ago; everything below shows
 * what it last knew". That banner is the only place in the system that admits
 * its data might be stale. Everywhere else — bids, leads, procurement scans,
 * intel — renders old data with exactly the same confidence as fresh data, so a
 * pipeline can die and the dashboard keeps looking healthy. This generalises the
 * banner into one check over every pipeline.
 *
 * Three decisions worth stating, all learned from the roadmap version:
 *
 * 1. **A run that changed nothing is still a healthy run.** `_status.md` is
 *    fingerprint-gated, so a quiet week does not move `generated_at`. Freshness
 *    is therefore the NEWER of the artifact's own stamp and the last successful
 *    line in the run log — never the artifact alone, which would call a working
 *    system stale.
 *
 * 2. **The expectation is derived from the live schedule, not declared.** A
 *    hardcoded "daily" becomes a lie the moment someone edits the cron.
 *    `declaredHours` exists only as a fallback for when the schedule cannot be
 *    read, and when both are available a DISAGREEMENT is itself reported — that
 *    is drift between what we believe and what is configured.
 *
 * 3. **"Never run" is not "late".** A pipeline staged but never started
 *    (email-sync, waiting on mail.env) is a different fact from one that ran for
 *    months and stopped, and collapsing them would hide the second inside the
 *    first.
 */

/** How to find a pipeline's last successful run. Executed by the script. */
export type Probe =
  /** Newest line in a run log matching a success pattern; captures an ISO stamp. */
  | { kind: 'log-ok'; path: string; pattern: string }
  /** A frontmatter field on a derived artifact, e.g. `generated_at`. */
  | { kind: 'frontmatter'; path: string; field: string }
  /** Newest `YYYY-MM-DD`-prefixed filename in a directory. */
  | { kind: 'dated-file'; dir: string; match: string }
  /** A file's modification time — last resort, for artifacts with no stamp. */
  | { kind: 'mtime'; path: string }

export interface Pipeline {
  key: string
  name: string
  /** What it produces, in the words a human would use. */
  produces: string
  /** openclaw cron job name, when it is one. Absent = launchd or manual. */
  cron?: string
  /** Fallback expectation in hours, used only when the schedule is unreadable. */
  declaredHours: number
  /** Every source that can evidence a run. The NEWEST wins — see decision 1. */
  probes: Probe[]
  /** Which machine actually runs it. A probe source missing on the OTHER machine
   *  is "no evidence here", never "never ran" — see `Evidence.sourceSeen`. */
  runsOn: 'mini' | 'macbook'
  /**
   * True when a run that finds nothing writes nothing.
   *
   * Most of these only touch their artifact when there is something to say — no
   * new solicitations, no new leads, no drift. For those, an UNCHANGED ARTIFACT
   * IS WHAT A HEALTHY QUIET RUN LOOKS LIKE, and calling it late is the cry-wolf
   * failure this whole check is supposed to avoid. When the only evidence is the
   * artifact, staleness on these reports `unknown`, not `late`; the authoritative
   * answer is the cron's own run record, which needs the gateway.
   */
  quietRunsAreNormal?: boolean
}

/** What we managed to learn about the last run, and how much it is worth. */
export interface Evidence {
  at: string | null
  /** A run RECORD (cron store, run log) outranks an artifact timestamp. */
  kind: 'run-record' | 'artifact' | 'none'
  /** Did any probe source exist on this machine at all? */
  sourceSeen: boolean
}

export type BeatState = 'ok' | 'late' | 'never' | 'unknown'

export interface Beat {
  key: string
  name: string
  produces: string
  state: BeatState
  lastAt: string | null
  ageHours: number | null
  expectHours: number
  expectFrom: 'schedule' | 'declared'
  detail: string
  /** Set when the live schedule and the declared expectation disagree. */
  drift?: string
}

/**
 * Grace before "late". Generous on purpose: a heartbeat that cries wolf is one
 * that gets muted, and a muted heartbeat is worse than none because it looks
 * like coverage. Half the interval again, and never less than an extra hour —
 * so hourly tolerates 2h, daily 36h, weekday-daily (72h gap) 108h.
 */
export function lateAfterHours(expectHours: number): number {
  return expectHours + Math.max(1, expectHours * 0.5)
}

export function evaluateBeat(
  p: Pipeline,
  ev: Evidence,
  scheduleGapHours: number | null,
  now: Date = new Date(),
): Beat {
  const lastAt = ev.at
  const expectHours = scheduleGapHours ?? p.declaredHours
  const expectFrom: Beat['expectFrom'] = scheduleGapHours == null ? 'declared' : 'schedule'

  // A schedule that disagrees with what we wrote down is drift in its own
  // right — the belief and the configuration have come apart, which is the
  // same disease the whole board exists to catch.
  let drift: string | undefined
  if (scheduleGapHours != null && Math.abs(scheduleGapHours - p.declaredHours) > 1) {
    drift = `cron fires at most every ${scheduleGapHours}h; this file declares ${p.declaredHours}h`
  }

  const base = { key: p.key, name: p.name, produces: p.produces, expectHours, expectFrom, drift }

  if (!lastAt) {
    // "Nothing here to look at" and "it has never run" are different facts, and
    // collapsing them turns every mini-side pipeline into a false alarm when this
    // runs on the MacBook.
    return ev.sourceSeen
      ? {
          ...base, state: 'never', lastAt: null, ageHours: null,
          detail: `no run has ever been recorded — expected every ${expectHours}h`,
        }
      : {
          ...base, state: 'unknown', lastAt: null, ageHours: null,
          detail: `no evidence source on this machine (runs on the ${p.runsOn})`,
        }
  }

  const t = new Date(lastAt).getTime()
  if (Number.isNaN(t)) {
    return {
      ...base, state: 'unknown', lastAt, ageHours: null,
      detail: `last-run stamp ${JSON.stringify(lastAt)} is not a date`,
    }
  }

  const ageHours = (now.getTime() - t) / 3_600_000
  // A stamp in the future is a clock or timezone fault, not freshness. Tonight's
  // UTC-vs-local bug produced exactly this shape, so it must not read healthy.
  if (ageHours < -1) {
    return {
      ...base, state: 'unknown', lastAt, ageHours,
      detail: `last run is ${Math.abs(Math.round(ageHours))}h in the FUTURE — check the clock`,
    }
  }

  const limit = lateAfterHours(expectHours)
  const rounded = Math.round(ageHours * 10) / 10

  // A quiet pipeline evidenced ONLY by its artifact cannot be judged: an
  // untouched file is equally what "nothing to report" and "dead" look like.
  if (ageHours > limit && p.quietRunsAreNormal && ev.kind === 'artifact') {
    return {
      ...base, state: 'unknown', lastAt, ageHours: rounded,
      detail: `artifact unchanged for ${rounded}h, but this pipeline only writes when it has `
        + 'something to write — no run record available here to tell quiet from dead',
    }
  }

  return {
    ...base,
    lastAt,
    ageHours: rounded,
    state: ageHours > limit ? 'late' : 'ok',
    detail: ageHours > limit
      ? `last run ${rounded}h ago, past the ${Math.round(limit)}h limit for a ${expectHours}h cadence`
      : `last run ${rounded}h ago, within a ${expectHours}h cadence`,
  }
}

/** Only the beats worth telling a human about, worst first. */
export function findings(beats: Beat[]): Beat[] {
  const rank: Record<BeatState, number> = { late: 0, unknown: 1, never: 2, ok: 3 }
  return beats
    .filter(b => b.state !== 'ok' || b.drift)
    .sort((a, b) => rank[a.state] - rank[b.state] || (b.ageHours ?? 0) - (a.ageHours ?? 0))
}
