/**
 * Lead store — discovered solicitations scored through the product lens.
 *
 * THE DESIGN CONSTRAINT, in Pavan's words: "I just don't want it processing the
 * same input over and over." So this module's whole job is deciding what is
 * genuinely NEW.
 *
 * Fetch redundancy is already solved upstream: the qual_table pipeline guards
 * concurrent runs (409), upserts by event identity, never overwrites triage, and
 * caches enrichment forever. What it cannot know is whether OUR verdict changed.
 * That is here.
 *
 * A lead is rewritten only when one of five things is true:
 *   1. it is new
 *   2. `event_version` moved — an addendum, which genuinely deserves re-reading
 *   3. our score or bucket changed
 *   4. LEAD_RULES_VERSION moved — the rules were retuned
 *   5. its deadline moved, or passed — see EXPIRY below
 *
 * Everything else is a no-op: no write, no commit, no re-surfacing. That matters
 * because the janitor commits every changed file, so writing 300 unchanged leads
 * daily would bury real signal in `git log`.
 *
 * TRIAGE IS STICKY. Once a human says bid / skip / watch, a refresh never resets
 * it. Only a version bump reopens a skipped lead, because an addendum can change
 * what the solicitation actually asks for.
 *
 * EXPIRY. A solicitation that has closed is not a lead. An event whose end_date
 * is already past is never ingested, and a stored lead whose end_date passes is
 * marked `triage: expired` on the next sync — once, so a --on-change run
 * announces the flip and is quiet afterwards. Nothing is deleted: the file is
 * the record that we saw it. Until 2026-09-14, 0531-0000039878 (closed
 * 2026-08-29) sat in the queue as `new` for sixteen days.
 *
 * TWO LENSES, ONE STORE. Every lead carries `entity` and `lens`:
 *   - InfiniteAI / product: scored HERE by lead-scoring.ts from gtm/lead-rules.md.
 *   - Infinite Solutions / consulting: scored by qual_table_automations' rules,
 *     which only run on the mini, inside scripts/caleprocure-scan.py. That scan
 *     writes a JSON sidecar of every open event with both verdicts, and
 *     `syncConsultingLeads` ingests the shortlist band from it. Its slugs end in
 *     `-is`, so the two lenses' leads for one solicitation coexist as two files
 *     and one human decision never overwrites the other.
 *   Files written before 2026-09-14 carry neither field and read as
 *   InfiniteAI / product, which is what they were. The EDD Salesforce M&O RFP
 *   (consulting 75, product 0) was the first lead the second path produced.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { acquireLock, atomicWrite, fileExists } from './store'
import { today } from './crm'
import { scoreEvent, getAgencyAffinity, loadRules } from './lead-scoring'
import type { LeadBucket, LeadVerdict, ProductSlug, ScorableEvent } from './lead-scoring'

export type LeadTriage = 'new' | 'bid' | 'skip' | 'watch' | 'expired'
export type LeadEntity = 'InfiniteAI' | 'Infinite Solutions'
export type LeadLens = 'product' | 'consulting'

/** The scan's shortlist threshold (relevance rules v3: shortlist at 40). */
export const IS_SHORTLIST_SCORE = 40

export interface Lead {
  slug: string
  source: string
  businessUnit: string
  eventId: string
  eventVersion?: number
  eventName: string
  department?: string
  endDate?: string
  entity: LeadEntity
  lens: LeadLens
  score: number
  bucket: LeadVerdict['bucket']
  products: ProductSlug[]
  tiers: string[]           // have / adjacent / could-build
  reasons: string[]
  rulesVersion: number
  provisional: boolean
  triage: LeadTriage
  firstSeen: string
  lastSeen: string
  lastScored: string
  notes: string
}

export interface SyncOutcome {
  created: number
  updated: number
  unchanged: number
  /** Incoming events skipped because their end_date had already passed. */
  expired: number
  reasons: { slug: string; why: string }[]
}

/**
 * One event of the sidecar `scripts/caleprocure-scan.py` writes beside its
 * markdown (`intelligence/procurements/<date>-caleprocure.json`). Field names
 * are the scan's; see `sidecar_event` there.
 */
export interface SidecarEvent {
  event_id: string
  business_unit?: string | null
  name: string
  department?: string | null
  end_date?: string | null       // YYYY-MM-DD, Pacific
  url?: string | null
  rules_version?: number
  lenses: Partial<Record<LeadLens, { score: number; bucket: string; reasons: string[] }>>
}

function leadSlug(businessUnit: string, eventId: string): string {
  // The state's event ids may contain a space; the pair is the natural key.
  return `${businessUnit}-${eventId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The solicitation a lead is about, regardless of lens: the product lead's slug
 * and the consulting lead's slug minus its `-is`. Also the `eventId` shape
 * procurements.ts gives an Opportunity, which is how the Clock dedupes them.
 */
export function leadEventKey(l: Pick<Lead, 'businessUnit' | 'eventId'>): string {
  return leadSlug(l.businessUnit, l.eventId)
}

function leadPath(slug: string): string {
  return path.join(PATHS.crmLeads, `${slug}.md`)
}

function serialize(l: Lead): string {
  const fm: Record<string, unknown> = {
    source: l.source,
    entity: l.entity,
    lens: l.lens,
    business_unit: l.businessUnit,
    event_id: l.eventId,
    event_version: l.eventVersion,
    event_name: l.eventName,
    department: l.department,
    end_date: l.endDate,
    score: l.score,
    bucket: l.bucket,
    products: l.products.length ? l.products : undefined,
    tiers: l.tiers.length ? l.tiers : undefined,
    reasons: l.reasons.length ? l.reasons : undefined,
    rules_version: l.rulesVersion,
    provisional: l.provisional || undefined,
    triage: l.triage,
    first_seen: l.firstSeen,
    last_seen: l.lastSeen,
    last_scored: l.lastScored,
  }
  for (const k of Object.keys(fm)) if (fm[k] === undefined || fm[k] === '') delete fm[k]

  const body = [
    `# ${l.eventName}`,
    '',
    l.department ? `**${l.department}**${l.endDate ? ` · closes ${l.endDate}` : ''}` : '',
    '',
    l.reasons.length ? '## Why this scored' : '',
    '',
    ...l.reasons.map(r => `- ${r}`),
    '',
    l.notes.trim() ? `## Notes\n\n${l.notes.trim()}\n` : '',
  ].join('\n')
  return matter.stringify(body, fm)
}

function hydrate(slug: string, raw: string): Lead {
  const { data, content } = matter(raw)
  const notesIdx = content.indexOf('## Notes')
  return {
    slug,
    source: String(data.source ?? 'caleprocure'),
    businessUnit: String(data.business_unit ?? ''),
    eventId: String(data.event_id ?? ''),
    eventVersion: typeof data.event_version === 'number' ? data.event_version : undefined,
    eventName: String(data.event_name ?? slug),
    department: data.department ? String(data.department) : undefined,
    endDate: data.end_date ? String(data.end_date) : undefined,
    // Absent on every file written before the consulting lens existed.
    entity: data.entity === 'Infinite Solutions' ? 'Infinite Solutions' : 'InfiniteAI',
    lens: data.lens === 'consulting' ? 'consulting' : 'product',
    score: Number(data.score ?? 0),
    bucket: (data.bucket ?? 'unlikely') as LeadVerdict['bucket'],
    products: Array.isArray(data.products) ? data.products as ProductSlug[] : [],
    tiers: Array.isArray(data.tiers) ? data.tiers.map(String) : [],
    reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
    rulesVersion: Number(data.rules_version ?? 0),
    provisional: Boolean(data.provisional),
    triage: (data.triage ?? 'new') as LeadTriage,
    firstSeen: String(data.first_seen ?? today()),
    lastSeen: String(data.last_seen ?? today()),
    lastScored: String(data.last_scored ?? today()),
    notes: notesIdx === -1 ? '' : content.slice(notesIdx + '## Notes'.length).trim(),
  }
}

export async function listLeads(): Promise<Lead[]> {
  if (!(await fileExists(PATHS.crmLeads))) return []
  const files = (await fs.readdir(PATHS.crmLeads)).filter(f => f.endsWith('.md') && !f.startsWith('.'))
  const out = await Promise.all(files.map(async f => {
    try { return hydrate(f.replace(/\.md$/, ''), await fs.readFile(path.join(PATHS.crmLeads, f), 'utf-8')) }
    catch { return null }   // one corrupt file must not blank the board
  }))
  return out.filter((l): l is Lead => l !== null)
    .sort((a, b) => b.score - a.score)
}

/** What a lens decided about an event, in the shape the store writes. */
interface StoredVerdict {
  score: number
  bucket: LeadBucket
  products: ProductSlug[]
  tiers: string[]
  reasons: string[]
  rulesVersion: number
  provisional: boolean
}

/** An event after scoring, before the store decides whether it changed. */
type ScoredEntry = Omit<Lead, 'score' | 'bucket' | 'products' | 'tiers' | 'reasons' | 'rulesVersion' | 'provisional' | 'triage' | 'firstSeen' | 'lastSeen' | 'lastScored' | 'notes'>
  & { verdict: StoredVerdict }

/**
 * Decide whether an incoming event is materially different from what we hold.
 * Returns null when nothing changed — the caller then writes nothing at all.
 */
function changeReason(
  prev: Lead | null, incoming: { eventVersion?: number; endDate?: string }, verdict: StoredVerdict,
): string | null {
  if (!prev) return 'new'
  if (incoming.eventVersion !== undefined && prev.eventVersion !== undefined && incoming.eventVersion !== prev.eventVersion) {
    return `addendum: version ${prev.eventVersion} → ${incoming.eventVersion}`
  }
  // A moved deadline is the one field change worth a rewrite on its own: it is
  // what decides whether the lead is still live, and an extension reopens one
  // that expired.
  if (incoming.endDate && incoming.endDate !== prev.endDate) {
    return `deadline: ${prev.endDate ?? 'none'} → ${incoming.endDate}`
  }
  if (prev.rulesVersion !== verdict.rulesVersion) {
    return `rescored: rules v${prev.rulesVersion} → v${verdict.rulesVersion}`
  }
  if (prev.bucket !== verdict.bucket) return `bucket: ${prev.bucket} → ${verdict.bucket}`
  if (prev.score !== verdict.score) return `score: ${prev.score} → ${verdict.score}`
  return null
}

function emptyOutcome(): SyncOutcome {
  return { created: 0, updated: 0, unchanged: 0, expired: 0, reasons: [] }
}

/**
 * The one write path. Persists only what changed, sweeps expiry, commits once.
 * Both lenses come through here; they differ only in who scored the entries.
 *
 * `lastSeen` is deliberately NOT a reason to rewrite: touching every file daily
 * just to record that an event still exists would defeat the entire point.
 */
async function commitEntries(entries: ScoredEntry[], via: string, outcome: SyncOutcome): Promise<SyncOutcome> {
  const release = await acquireLock(PATHS.crm, PATHS.crmLeads)
  const now = today()

  try {
    for (const { verdict, ...ev } of entries) {
      const { slug } = ev

      // Never surface noise. An unlikely event that we have never stored stays
      // unstored: 311 events per refresh, of which ~2-3% are ours.
      const prevRaw = await fileExists(leadPath(slug))
        ? await fs.readFile(leadPath(slug), 'utf-8').catch(() => null)
        : null
      const prev = prevRaw ? hydrate(slug, prevRaw) : null
      if (!prev && verdict.bucket === 'unlikely') { outcome.unchanged++; continue }

      const why = changeReason(prev, ev, verdict)
      if (!why) { outcome.unchanged++; continue }

      const lead: Lead = {
        ...ev,
        ...verdict,
        // STICKY: a refresh never resets a human decision. An addendum reopens a
        // skipped lead, because it can change what the solicitation asks for;
        // a deadline that moved forward reopens an expired one.
        triage: prev
          ? (why.startsWith('addendum') && prev.triage === 'skip') || prev.triage === 'expired' ? 'new' : prev.triage
          : 'new',
        firstSeen: prev?.firstSeen ?? now,
        lastSeen: now,
        lastScored: now,
        notes: prev?.notes ?? '',
      }

      await atomicWrite(leadPath(slug), serialize(lead))
      if (prev) outcome.updated++; else outcome.created++
      outcome.reasons.push({ slug, why })
    }

    // The expiry sweep: every stored lead past its deadline flips to `expired`
    // exactly once. Leads written above all carry a future deadline (or none),
    // so nothing is touched twice in one run.
    for (const lead of await listLeads()) {
      if (!lead.endDate || lead.endDate >= now || lead.triage === 'expired') continue
      lead.triage = 'expired'
      await atomicWrite(leadPath(lead.slug), serialize(lead))
      outcome.updated++
      outcome.reasons.push({ slug: lead.slug, why: `expired: closed ${lead.endDate}` })
    }

    // ONE commit for the batch, not one per lead. A daily sync that produced
    // three real changes should read as three lines in git log, not 300.
    if (outcome.created || outcome.updated) {
      const rel = path.relative(PATHS.operationsRoot, PATHS.crmLeads)
      const summary = `${outcome.created} new, ${outcome.updated} updated`
      try {
        await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 30_000)
        await runCommandArgs('git', [
          '-C', PATHS.operationsRoot, 'commit', '-q',
          '-m', `leads: ${summary}`,
          '-m', outcome.reasons.map(r => `${r.slug}: ${r.why}`).join('\n') + `\nvia: ${via}`,
        ], 30_000)
      } catch { /* nothing staged, or git unavailable — janitor sweeps */ }
    }
  } finally {
    await release()
  }
  return outcome
}

/**
 * Score a batch of discovered events through the PRODUCT lens and persist only
 * what changed. Rules and affinity are read ONCE for the whole batch, not per
 * event.
 */
export async function syncLeads(
  events: (ScorableEvent & { businessUnit: string; eventId: string; eventVersion?: number; source?: string })[],
  via = 'lead-sync',
): Promise<SyncOutcome> {
  const [affinity, rules] = await Promise.all([getAgencyAffinity(), loadRules(true)])
  const outcome = emptyOutcome()
  const now = today()
  const entries: ScoredEntry[] = []

  for (const ev of events) {
    // Closed is closed. The stored copy, if any, is handled by the sweep.
    if (ev.endDate && ev.endDate < now) { outcome.expired++; continue }
    const verdict = await scoreEvent(ev, affinity, rules)
    entries.push({
      slug: leadSlug(ev.businessUnit, ev.eventId),
      source: ev.source ?? 'caleprocure',
      businessUnit: ev.businessUnit,
      eventId: ev.eventId,
      eventVersion: ev.eventVersion,
      eventName: ev.eventName,
      department: ev.departmentName,
      endDate: ev.endDate,
      entity: 'InfiniteAI',
      lens: 'product',
      verdict: {
        score: verdict.score,
        bucket: verdict.bucket,
        products: verdict.products,
        tiers: verdict.tiers,
        reasons: verdict.reasons.map(r => `${r.weight > 0 ? '+' : ''}${r.weight} ${r.reason}`),
        rulesVersion: verdict.rulesVersion,
        provisional: verdict.provisional,
      },
    })
  }
  return commitEntries(entries, via, outcome)
}

/** The newest sidecar the scan wrote, or null before the first run. */
export async function readLatestSidecar(): Promise<{ file: string; events: SidecarEvent[] } | null> {
  if (!(await fileExists(PATHS.procurements))) return null
  const files = (await fs.readdir(PATHS.procurements))
    .filter(f => /^\d{4}-\d{2}-\d{2}-caleprocure\.json$/.test(f))
    .sort()
  const file = files[files.length - 1]
  if (!file) return null
  const parsed: unknown = JSON.parse(await fs.readFile(path.join(PATHS.procurements, file), 'utf-8'))
  return { file, events: Array.isArray(parsed) ? parsed as SidecarEvent[] : [] }
}

function bucketOf(raw: string, score: number): LeadBucket {
  if (raw === 'likely' || raw === 'possible' || raw === 'unlikely') return raw
  return score >= IS_SHORTLIST_SCORE ? 'likely' : 'possible'
}

/**
 * Ingest the CONSULTING lens from the scan's sidecar: every open event the
 * qual_table rules put on the Infinite Solutions shortlist becomes a lead with
 * an `-is` slug. Same change detection, expiry sweep and single commit as the
 * product path; a lead whose score later drops below the line is left alone,
 * never deleted.
 */
export async function syncConsultingLeads(events: SidecarEvent[], via = 'lead-sync'): Promise<SyncOutcome> {
  const outcome = emptyOutcome()
  const now = today()
  const entries: ScoredEntry[] = []

  for (const ev of events) {
    const c = ev.lenses?.consulting
    if (!c || c.score < IS_SHORTLIST_SCORE) { outcome.unchanged++; continue }
    if (ev.end_date && ev.end_date < now) { outcome.expired++; continue }
    const businessUnit = ev.business_unit ?? ''
    entries.push({
      slug: `${leadSlug(businessUnit, ev.event_id)}-is`,
      source: 'caleprocure',
      businessUnit,
      eventId: ev.event_id,
      eventName: ev.name,
      department: ev.department ?? undefined,
      endDate: ev.end_date ?? undefined,
      entity: 'Infinite Solutions',
      lens: 'consulting',
      verdict: {
        score: c.score,
        bucket: bucketOf(c.bucket, c.score),
        products: [],
        tiers: [],
        reasons: c.reasons ?? [],
        rulesVersion: ev.rules_version ?? 0,
        // The scan scores list rows, without description or commodity codes.
        provisional: true,
      },
    })
  }
  return commitEntries(entries, via, outcome)
}

/** Record a human decision. Sticky against every subsequent sync. */
export async function triageLead(slug: string, triage: LeadTriage, via = 'dashboard'): Promise<Lead | null> {
  const release = await acquireLock(PATHS.crm, PATHS.crmLeads)
  try {
    if (!(await fileExists(leadPath(slug)))) return null
    const lead = hydrate(slug, await fs.readFile(leadPath(slug), 'utf-8'))
    if (lead.triage === triage) return lead
    lead.triage = triage
    await atomicWrite(leadPath(slug), serialize(lead))
    const rel = path.relative(PATHS.operationsRoot, leadPath(slug))
    try {
      await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
      await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'commit', '-q',
        '-m', `leads: ${triage} — ${lead.eventName.slice(0, 60)}`, '-m', `via: ${via}`, '--', rel], 15_000)
    } catch { /* janitor sweeps */ }
    return lead
  } finally {
    await release()
  }
}

/** Leads awaiting a human decision, best-first. The dashboard's triage queue. */
export async function getLeadQueue(): Promise<Lead[]> {
  return (await listLeads()).filter(l => l.triage === 'new' && l.bucket !== 'unlikely')
}
