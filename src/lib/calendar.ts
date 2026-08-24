/**
 * Upcoming meetings from Google Calendar private ICS feeds.
 *
 * File-driven like everything else — no OAuth flow, no account credentials,
 * no third-party sync service. Every calendar provider hands out a read-only
 * secret ICS URL, so aggregating N accounts is just N entries here:
 *
 *   Google:  Settings → [calendar] → Integrate calendar → "Secret address in
 *            iCal format"
 *   Outlook: Settings → Calendar → Shared calendars → Publish → ICS link
 *   iCloud:  share → Public Calendar (webcal:// is rewritten to https://)
 *
 *   ~/.openclaw/workspace/.credentials/calendar.json
 *   { "icsUrls": [
 *       "https://calendar.google.com/calendar/ical/…/basic.ics",
 *       { "url": "https://outlook.office365.com/…/calendar.ics", "name": "Work" }
 *   ] }
 *
 * Entries are plain URLs or { url, name }; the name overrides the feed's own
 * X-WR-CALNAME as the label shown on the card (Google's primary-calendar name
 * is the raw email address, which is fine until two accounts need telling
 * apart). CALENDAR_ICS_URLS (comma-separated) overrides the file — dev use.
 *
 * Feeds are fetched through Next's data cache with a 10-minute revalidate so
 * dashboard refreshes never hammer Google. Recurring events are expanded for
 * the lookahead window: FREQ=DAILY/WEEKLY/MONTHLY with INTERVAL, BYDAY
 * (weekly), UNTIL and COUNT, plus EXDATE and RECURRENCE-ID overrides.
 * Exotic rules (YEARLY, BYSETPOS, WKST≠MO) are not expanded.
 */
import fs from 'fs/promises'
import { PATHS } from './paths'

export interface Meeting {
  uid: string
  title: string
  startAt: string // ISO
  endAt?: string
  allDay: boolean
  location?: string
  calendar: string // X-WR-CALNAME, or "calendar N" when the feed omits it
  isDemo: boolean
}

export interface CalendarResult {
  configured: boolean
  meetings: Meeting[]
  /** Per-feed fetch/parse failures — shown so an expired secret URL is visible, not silent. */
  errors: string[]
}

export const LOOKAHEAD_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_OCCURRENCES = 2000 // recurrence-expansion hard stop

// Exported: the scoreboard counts demos in the meeting archive with the same
// definition the calendar uses, so "demo" means one thing everywhere.
export const DEMO_RE = /\b(demo|walkthrough|poc|pilot)\b/i

export interface FeedConfig {
  url: string
  name?: string
}

/** webcal:// (iCloud's scheme) is ICS-over-https under a different name. */
function normalizeUrl(u: string): string {
  return u.trim().replace(/^webcal:\/\//i, 'https://')
}

export function parseFeedConfigs(entries: unknown): FeedConfig[] {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry): FeedConfig | null => {
      if (typeof entry === 'string') return { url: normalizeUrl(entry) }
      if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
        const e = entry as { url: string; name?: unknown }
        return { url: normalizeUrl(e.url), name: typeof e.name === 'string' ? e.name : undefined }
      }
      return null
    })
    .filter((f): f is FeedConfig => Boolean(f?.url))
}

async function loadFeedConfigs(): Promise<FeedConfig[]> {
  const env = process.env.CALENDAR_ICS_URLS
  if (env?.trim()) return parseFeedConfigs(env.split(','))
  try {
    const parsed = JSON.parse(await fs.readFile(PATHS.calendarConfig, 'utf-8'))
    return parseFeedConfigs(parsed.icsUrls)
  } catch {
    // no file / bad JSON → not configured
    return []
  }
}

// ---------------------------------------------------------------------------
// ICS parsing

interface IcsProp {
  params: Record<string, string>
  value: string
}

type IcsComponent = Record<string, IcsProp[]>

/** RFC 5545 line unfolding: CRLF followed by space/tab continues the line. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

/** "DTSTART;TZID=America/Los_Angeles:20260901T100000" → name/params/value. */
function parseLine(line: string): { name: string; prop: IcsProp } | null {
  // The first ':' outside double quotes separates prop from value.
  let inQuotes = false
  let sep = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ':' && !inQuotes) { sep = i; break }
  }
  if (sep < 0) return null
  const [name, ...paramParts] = line.slice(0, sep).split(';')
  const params: Record<string, string> = {}
  for (const p of paramParts) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), prop: { params, value: line.slice(sep + 1) } }
}

function parseComponents(lines: string[]): { calendarName?: string; events: IcsComponent[] } {
  const events: IcsComponent[] = []
  let calendarName: string | undefined
  let current: IcsComponent | null = null
  let depth = 0 // skip nested components (VALARM) inside events

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; depth = 0; continue }
    if (current) {
      if (line.startsWith('BEGIN:')) { depth++; continue }
      if (line === 'END:VEVENT') { events.push(current); current = null; continue }
      if (line.startsWith('END:')) { depth--; continue }
      if (depth > 0) continue
      const parsed = parseLine(line)
      if (parsed) (current[parsed.name] ??= []).push(parsed.prop)
    } else if (line.startsWith('X-WR-CALNAME:')) {
      calendarName = line.slice('X-WR-CALNAME:'.length).trim()
    }
  }
  return { calendarName, events }
}

/** Unescape RFC 5545 text values (\n \, \; \\). */
function icsText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()
}

// ---------------------------------------------------------------------------
// Dates. Wall-clock components are carried as "pretend UTC" ms (the local
// time interpreted as if it were UTC) so recurrence stepping is DST-free;
// each occurrence converts to real UTC through its TZID at the end.

interface WallTime {
  wallMs: number // components as Date.UTC(...)
  tzid?: string // IANA zone; undefined = floating (server-local)
  isUtc: boolean
  isDate: boolean // all-day (VALUE=DATE)
}

function parseIcsDate(prop: IcsProp): WallTime | null {
  const v = prop.value.trim()
  const dateOnly = prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const wallMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  return { wallMs, tzid: prop.params.TZID, isUtc: m[7] === 'Z', isDate: dateOnly }
}

/** Offset of `tz` from UTC at the given instant. */
function tzOffsetMs(tz: string, atUtc: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(atUtc))
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return asUtc - atUtc
}

/** Wall-clock ms (+ zone) → real epoch ms. Two passes to settle DST edges. */
function wallToEpoch(wallMs: number, wall: WallTime): number {
  if (wall.isUtc) return wallMs
  if (wall.tzid) {
    try {
      const guess = wallMs - tzOffsetMs(wall.tzid, wallMs)
      return wallMs - tzOffsetMs(wall.tzid, guess)
    } catch {
      // unknown TZID string → fall through to server-local
    }
  }
  // Floating / all-day: server-local wall clock.
  const d = new Date(wallMs)
  return new Date(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
  ).getTime()
}

// ---------------------------------------------------------------------------
// Recurrence

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  interval: number
  byday?: number[] // JS weekday numbers (0=Sun) — WEEKLY only
  untilWallMs?: number
  count?: number
}

const BYDAY_NUM: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseRRule(value: string): RRule | null {
  const parts = Object.fromEntries(
    value.split(';').map(p => {
      const eq = p.indexOf('=')
      return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)]
    }),
  )
  if (parts.FREQ !== 'DAILY' && parts.FREQ !== 'WEEKLY' && parts.FREQ !== 'MONTHLY') return null
  const byday = parts.BYDAY
    ? parts.BYDAY.split(',').map(d => BYDAY_NUM[d.slice(-2)]).filter((n): n is number => n !== undefined)
    : undefined
  let untilWallMs: number | undefined
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/)
    if (m) untilWallMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? 59))
  }
  return {
    freq: parts.FREQ,
    interval: Math.max(1, parseInt(parts.INTERVAL ?? '1', 10) || 1),
    byday: parts.FREQ === 'WEEKLY' ? byday : undefined,
    untilWallMs,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : undefined,
  }
}

/**
 * Occurrence starts in wall-ms. COUNT forces expansion from DTSTART, so
 * everything is generated then window-filtered by the caller; MAX_OCCURRENCES
 * bounds pathological feeds.
 */
function expandRRule(rule: RRule, startWallMs: number, maxWallMs: number): number[] {
  const out: number[] = []
  const limit = rule.count ?? MAX_OCCURRENCES
  const until = Math.min(rule.untilWallMs ?? Infinity, maxWallMs)

  if (rule.freq === 'WEEKLY' && rule.byday?.length) {
    // Anchor on the Monday of DTSTART's week (WKST=MO default), emit each
    // requested weekday at DTSTART's time-of-day.
    const start = new Date(startWallMs)
    const timeOfDay = startWallMs - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    const mondayOffset = (start.getUTCDay() + 6) % 7
    const weekAnchor = startWallMs - timeOfDay - mondayOffset * DAY_MS
    const days = [...rule.byday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    for (let week = 0; out.length < limit; week++) {
      const base = weekAnchor + week * rule.interval * 7 * DAY_MS
      if (base > until) break
      for (const day of days) {
        const occ = base + ((day + 6) % 7) * DAY_MS + timeOfDay
        if (occ < startWallMs || occ > until) continue
        out.push(occ)
        if (out.length >= limit) break
      }
      if (week > MAX_OCCURRENCES) break
    }
    return out
  }

  if (rule.freq === 'MONTHLY') {
    const s = new Date(startWallMs)
    for (let i = 0; out.length < limit && i < MAX_OCCURRENCES; i++) {
      const occ = Date.UTC(
        s.getUTCFullYear(), s.getUTCMonth() + i * rule.interval, s.getUTCDate(),
        s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds(),
      )
      if (occ > until) break
      // Date.UTC rolls "Feb 31" into March — that month simply has no occurrence.
      if (new Date(occ).getUTCDate() !== s.getUTCDate()) continue
      out.push(occ)
    }
    return out
  }

  const stepMs = rule.interval * (rule.freq === 'WEEKLY' ? 7 : 1) * DAY_MS
  for (let occ = startWallMs, i = 0; occ <= until && out.length < limit && i < MAX_OCCURRENCES; occ += stepMs, i++) {
    out.push(occ)
  }
  return out
}

// ---------------------------------------------------------------------------
// Feed → meetings

function first(ev: IcsComponent, name: string): IcsProp | undefined {
  return ev[name]?.[0]
}

export function parseIcsFeed(ics: string, feedIndex: number, windowStartMs: number, windowEndMs: number, label?: string): Meeting[] {
  const { calendarName, events } = parseComponents(unfold(ics))
  const calendar = label ?? calendarName ?? `calendar ${feedIndex + 1}`

  // Instances a RECURRENCE-ID override replaces (keyed by uid + wall-ms).
  const overridden = new Set<string>()
  for (const ev of events) {
    const rid = first(ev, 'RECURRENCE-ID')
    const uid = first(ev, 'UID')?.value
    if (rid && uid) {
      const t = parseIcsDate(rid)
      if (t) overridden.add(`${uid}|${t.wallMs}`)
    }
  }

  const out: Meeting[] = []
  for (const ev of events) {
    if (first(ev, 'STATUS')?.value === 'CANCELLED') continue
    const uid = first(ev, 'UID')?.value ?? ''
    const startProp = first(ev, 'DTSTART')
    if (!startProp) continue
    const start = parseIcsDate(startProp)
    if (!start) continue

    const endProp = first(ev, 'DTEND') ?? first(ev, 'DTSTART')
    const end = endProp ? parseIcsDate(endProp) : null
    const durationMs = end ? Math.max(0, end.wallMs - start.wallMs) : 0

    const title = icsText(first(ev, 'SUMMARY')?.value ?? '(untitled)')
    const location = first(ev, 'LOCATION') ? icsText(first(ev, 'LOCATION')!.value) : undefined
    const isOverride = Boolean(first(ev, 'RECURRENCE-ID'))

    const rruleProp = first(ev, 'RRULE')
    const rule = rruleProp && !isOverride ? parseRRule(rruleProp.value) : null

    let startWallTimes: number[]
    if (rule) {
      const exdates = new Set<number>()
      for (const ex of ev['EXDATE'] ?? []) {
        for (const val of ex.value.split(',')) {
          const t = parseIcsDate({ params: ex.params, value: val })
          if (t) exdates.add(t.wallMs)
        }
      }
      // Expand a little past the window end so an in-progress long event isn't missed.
      startWallTimes = expandRRule(rule, start.wallMs, windowEndMs + DAY_MS)
        .filter(w => !exdates.has(w) && !overridden.has(`${uid}|${w}`))
    } else {
      startWallTimes = [start.wallMs]
    }

    for (const wallMs of startWallTimes) {
      const startEpoch = wallToEpoch(wallMs, start)
      const endEpoch = durationMs > 0 ? startEpoch + durationMs : undefined
      // Keep: not over yet, starts inside the window.
      if ((endEpoch ?? startEpoch + 1) <= windowStartMs) continue
      if (startEpoch > windowEndMs) continue
      out.push({
        uid: `${uid}|${wallMs}`,
        title,
        startAt: new Date(startEpoch).toISOString(),
        endAt: endEpoch ? new Date(endEpoch).toISOString() : undefined,
        allDay: start.isDate,
        location,
        calendar,
        isDemo: DEMO_RE.test(title),
      })
    }
  }
  return out
}

export async function getUpcomingMeetings(): Promise<CalendarResult> {
  const feeds = await loadFeedConfigs()
  if (feeds.length === 0) return { configured: false, meetings: [], errors: [] }

  const now = Date.now()
  const windowEnd = now + LOOKAHEAD_DAYS * DAY_MS
  const errors: string[] = []
  const meetings: Meeting[] = []

  await Promise.all(feeds.map(async (feed, i) => {
    try {
      const res = await fetch(feed.url, { next: { revalidate: 600 } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      meetings.push(...parseIcsFeed(await res.text(), i, now, windowEnd, feed.name))
    } catch (e) {
      errors.push(`${feed.name ?? `calendar ${i + 1}`}: ${e instanceof Error ? e.message : 'fetch failed'}`)
    }
  }))

  meetings.sort((a, b) => a.startAt.localeCompare(b.startAt))
  return { configured: true, meetings, errors }
}
