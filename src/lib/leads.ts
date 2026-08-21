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
 * A lead is rewritten only when one of four things is true:
 *   1. it is new
 *   2. `event_version` moved — an addendum, which genuinely deserves re-reading
 *   3. our score or bucket changed
 *   4. LEAD_RULES_VERSION moved — the rules were retuned
 *
 * Everything else is a no-op: no write, no commit, no re-surfacing. That matters
 * because the janitor commits every changed file, so writing 300 unchanged leads
 * daily would bury real signal in `git log`.
 *
 * TRIAGE IS STICKY. Once a human says bid / skip / watch, a refresh never resets
 * it. Only a version bump reopens a skipped lead, because an addendum can change
 * what the solicitation actually asks for.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { acquireLock, atomicWrite, fileExists } from './store'
import { today } from './crm'
import { scoreEvent, getAgencyAffinity, loadRules } from './lead-scoring'
import type { LeadVerdict, ProductSlug, ScorableEvent } from './lead-scoring'

export type LeadTriage = 'new' | 'bid' | 'skip' | 'watch'

export interface Lead {
  slug: string
  source: string
  businessUnit: string
  eventId: string
  eventVersion?: number
  eventName: string
  department?: string
  endDate?: string
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
  reasons: { slug: string; why: string }[]
}

function leadSlug(businessUnit: string, eventId: string): string {
  // The state's event ids may contain a space; the pair is the natural key.
  return `${businessUnit}-${eventId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

function leadPath(slug: string): string {
  return path.join(PATHS.crmLeads, `${slug}.md`)
}

function serialize(l: Lead): string {
  const fm: Record<string, unknown> = {
    source: l.source,
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

/**
 * Decide whether an incoming event is materially different from what we hold.
 * Returns null when nothing changed — the caller then writes nothing at all.
 */
function changeReason(prev: Lead | null, incomingVersion: number | undefined, verdict: LeadVerdict): string | null {
  if (!prev) return 'new'
  if (incomingVersion !== undefined && prev.eventVersion !== undefined && incomingVersion !== prev.eventVersion) {
    return `addendum: version ${prev.eventVersion} → ${incomingVersion}`
  }
  if (prev.rulesVersion !== verdict.rulesVersion) {
    return `rescored: rules v${prev.rulesVersion} → v${verdict.rulesVersion}`
  }
  if (prev.bucket !== verdict.bucket) return `bucket: ${prev.bucket} → ${verdict.bucket}`
  if (prev.score !== verdict.score) return `score: ${prev.score} → ${verdict.score}`
  return null
}

/**
 * Score a batch of discovered events and persist only what changed.
 *
 * `lastSeen` is deliberately NOT a reason to rewrite: touching every file daily
 * just to record that an event still exists would defeat the entire point.
 */
export async function syncLeads(
  events: (ScorableEvent & { businessUnit: string; eventId: string; eventVersion?: number; source?: string })[],
  via = 'lead-sync',
): Promise<SyncOutcome> {
  // Rules and affinity are read ONCE for the whole batch, not per event.
  const [affinity, rules] = await Promise.all([getAgencyAffinity(), loadRules(true)])
  const outcome: SyncOutcome = { created: 0, updated: 0, unchanged: 0, reasons: [] }
  const release = await acquireLock(PATHS.crm, PATHS.crmLeads)

  try {
    for (const ev of events) {
      const slug = leadSlug(ev.businessUnit, ev.eventId)
      const verdict = await scoreEvent(ev, affinity, rules)

      // Never surface noise. An unlikely event that we have never stored stays
      // unstored: 311 events per refresh, of which ~2-3% are ours.
      const prevRaw = await fileExists(leadPath(slug))
        ? await fs.readFile(leadPath(slug), 'utf-8').catch(() => null)
        : null
      const prev = prevRaw ? hydrate(slug, prevRaw) : null
      if (!prev && verdict.bucket === 'unlikely') { outcome.unchanged++; continue }

      const why = changeReason(prev, ev.eventVersion, verdict)
      if (!why) { outcome.unchanged++; continue }

      const now = today()
      const lead: Lead = {
        slug,
        source: ev.source ?? 'caleprocure',
        businessUnit: ev.businessUnit,
        eventId: ev.eventId,
        eventVersion: ev.eventVersion,
        eventName: ev.eventName,
        department: ev.departmentName,
        endDate: ev.endDate,
        score: verdict.score,
        bucket: verdict.bucket,
        products: verdict.products,
        tiers: verdict.tiers,
        reasons: verdict.reasons.map(r => `${r.weight > 0 ? '+' : ''}${r.weight} ${r.reason}`),
        rulesVersion: verdict.rulesVersion,
        provisional: verdict.provisional,
        // STICKY: a refresh never resets a human decision. An addendum reopens a
        // skipped lead, because it can change what the solicitation asks for.
        triage: prev
          ? (why.startsWith('addendum') && prev.triage === 'skip' ? 'new' : prev.triage)
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
