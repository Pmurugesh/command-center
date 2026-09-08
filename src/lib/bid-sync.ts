/**
 * Bid connector store — the workbench's bids, mirrored into operations.
 *
 * ONE-WAY. The qual-table workbench (BidPro) is the only place a bid's status
 * changes; this module writes what it reads there into each bid's
 * `.status.json` and never sends anything back. Decided 2026-09-08 (see
 * operations/workflows/unified-bid-system-handoff.md, "What we are NOT doing").
 *
 * The three things this module has to get right, in the order they were
 * found to matter:
 *
 *   1. IDENTITY is `source.bid_id`, never the folder name. A folder is created
 *      once as slug(display_name) and never renamed, because the display name
 *      can change in the workbench and the id cannot.
 *   2. A RICHER STAGE IS NEVER OVERWRITTEN BY A COARSER ONE unless the
 *      workbench's own status moved (a reopen is real and must show). Stages
 *      are ranked; the connector only compares ranks.
 *   3. NOTHING IS WRITTEN WHEN NOTHING CHANGED. `syncedAt` alone is never a
 *      reason to rewrite — the janitor commits every changed file, and a
 *      sync that touched 16 files hourly would bury real changes in git log.
 *
 * Failure renders unknown: the caller (scripts/sync-bids.ts) writes nothing on
 * a timeout or a bad response and appends one line to PATHS.bidSyncLog; the
 * Today freshness row reads that log's last success and goes amber past a
 * day and red past three (a weekend plus a missed Monday), never green on
 * silence.
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { acquireLock, atomicWrite, fileExists } from './store'
import { today } from './crm'
import type { BidStatus, Entity } from './config'
import type { BidStage, BidStatusData } from '@/types'

/** One row of GET /api/v1/bids/summary as the workbench serves it today
 *  (qual_table_app/backend/app/models/bids_summary.py), plus the optional
 *  fields the handoff asks for. Every optional field is read when present and
 *  ignored when absent, so the connector keeps working while they ship. */
export interface RemoteBid {
  bid_id: number
  name: string
  display_name: string
  status: string | null            // open | submitted | won | lost
  due_date?: string | null         // YYYY-MM-DD
  days_left?: number | null
  contract_value?: number | null
  updated_at?: string | null
  roles_total?: number
  roles_staffed?: number
  roles_to_staff?: number
  slots_total?: number
  slots_filled?: number
  pipeline?: { match?: boolean; resume?: boolean; tables?: boolean; submit?: boolean }
  // ── asked for in the handoff, not served yet ──
  agency?: string | null
  questions_due_date?: string | null
  status_changed_at?: string | null
  entity?: string | null
  org_id?: string | null
  discovery_event?: { business_unit: string; event_id: string } | null
  plan_sections?: string[] | null
  decisions_open?: number | null
  gate?: { status: 'pass' | 'fail' | 'unknown'; platform_ref?: string | null; verified_at?: string | null } | null
}

/** The stage ladder, ranked. Same rank = parallel stages (staffing vs solution). */
export const STAGE_RANK: Record<BidStage, number> = {
  'intake': 0,
  'scanned': 1,
  'planned': 2,
  'team-confirmed': 3,
  'tailoring': 4,
  'drafted': 4,
  'gated': 5,
  'ready-to-submit': 5,
  'lapsed': 6,
  'submitted': 6,
  'awarded': 7,
  'closed': 7,
}

/** Every bid in the workbench today is an Infinite Solutions staffing bid (16 of
 *  16 on 2026-09-08). Used only when the workbench serves no `entity` and the
 *  folder has none either; the handoff asks for the field so this goes away. */
export const DEFAULT_WORKBENCH_ENTITY: Entity = 'Infinite Solutions'

export interface Mapped {
  status: BidStatus
  stage: BidStage
  reason: string
}

/**
 * The mapping table from the handoff, "How we map your fields to our three".
 * Pure: workbench row → our status, stage, generated reason.
 */
export function mapRemote(r: RemoteBid, todayIso = today()): Mapped {
  const s = (r.status ?? '').toLowerCase()
  if (s === 'submitted') return { status: 'Submitted', stage: 'submitted', reason: 'submitted in the workbench' }
  if (s === 'won') return { status: 'Won', stage: 'awarded', reason: 'won in the workbench' }
  if (s === 'lost') return { status: 'Lost', stage: 'closed', reason: 'lost in the workbench' }

  // open (or anything unrecognised, which we treat as open rather than invent)
  if (r.due_date && r.due_date < todayIso) {
    // Decided 2026-09-08: auto-mark. A later `submitted` from the workbench
    // still overrides this, because the status itself moved.
    return {
      status: 'No-Bid', stage: 'lapsed',
      reason: `due date ${r.due_date} passed without submission; the workbench lists it as Completed`,
    }
  }
  const p = r.pipeline ?? {}
  const rolesTotal = r.roles_total ?? 0
  const toStaff = r.roles_to_staff ?? Math.max(0, rolesTotal - (r.roles_staffed ?? 0))
  if (p.match && p.resume && p.tables) {
    return { status: 'Under Review', stage: 'ready-to-submit', reason: 'team, resumes and tables confirmed' }
  }
  if (p.match && (p.resume || p.tables)) {
    return { status: 'Draft Ready', stage: 'tailoring', reason: `team confirmed; ${p.resume ? 'resumes' : 'tables'} confirmed` }
  }
  if (p.match) {
    return { status: 'Analyzing', stage: 'team-confirmed', reason: `team confirmed, ${rolesTotal} roles` }
  }
  if (rolesTotal > 0) {
    return { status: 'Analyzing', stage: 'scanned', reason: `${rolesTotal} roles, ${toStaff} to staff` }
  }
  return { status: 'Discovered', stage: 'intake', reason: 'adopted, not yet scanned' }
}

/** Folder name for a new connector bid. Created once, never renamed. */
export function bidFolderSlug(displayName: string, bidId: number): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || `qt-${bidId}`
}

interface Existing { folder: string; data: BidStatusData }

/** Every bid folder's status file, keyed by folder. Corrupt files are skipped
 *  (they would be rewritten as if new, which is the safer failure). */
async function readAllStatuses(): Promise<Existing[]> {
  if (!(await fileExists(PATHS.bids))) return []
  const entries = await fs.readdir(PATHS.bids, { withFileTypes: true })
  const out: Existing[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue
    const p = path.join(PATHS.bids, e.name, '.status.json')
    if (!(await fileExists(p))) continue
    try {
      out.push({ folder: e.name, data: JSON.parse(await fs.readFile(p, 'utf-8')) as BidStatusData })
    } catch { /* corrupt sidecar — treated as absent */ }
  }
  return out
}

/** The fields the connector owns. Two status files are "the same" for the
 *  purpose of change detection when these agree; `updatedAt`/`syncedAt` are
 *  deliberately not in here. */
function connectorView(d: Partial<BidStatusData>) {
  return JSON.stringify({
    status: d.status, stage: d.stage, reason: d.reason, entity: d.entity,
    deadline: d.deadline, questionsDue: d.questionsDue, agency: d.agency,
    contractValue: d.contractValue, pipeline: d.pipeline, coverage: d.coverage,
    plan: d.plan, decisionsOpen: d.decisionsOpen, gate: d.gate,
    discoveryEvent: d.discoveryEvent, source: d.source,
  })
}

/** Build the next status file for one workbench row, honouring the three rules. */
export function nextStatus(r: RemoteBid, prev: BidStatusData | undefined, now: string, todayIso = today()): BidStatusData {
  const mapped = mapRemote(r, todayIso)
  const prevFromConnector = prev?.via === 'qual-table'
  const remoteStatusMoved = prev?.source?.status !== undefined && prev.source.status !== (r.status ?? '')

  // Rule 2: never lower the stage unless the workbench status itself moved.
  let { status, stage, reason } = mapped
  if (prev?.stage && !remoteStatusMoved && STAGE_RANK[mapped.stage] < (STAGE_RANK[prev.stage] ?? -1)) {
    stage = prev.stage
    status = prev.status
    reason = prev.reason ?? reason
  }
  // A hand-written reason on a markdown-era bid is a fact we do not own.
  if (prev && !prevFromConnector && prev.reason) reason = prev.reason

  const rolesTotal = r.roles_total ?? 0
  const entity = (r.entity as Entity | undefined) || prev?.entity || DEFAULT_WORKBENCH_ENTITY

  const next: BidStatusData = {
    ...prev,                                   // preserves archived, notes, unknown keys
    status,
    entity,
    stage,
    reason,
    via: 'qual-table',
    source: { system: 'qual-table', bid_id: r.bid_id, name: r.name, status: r.status ?? '', ...(r.org_id ? { org_id: r.org_id } : {}) },
    deadline: r.due_date ?? prev?.deadline,
    questionsDue: r.questions_due_date ?? prev?.questionsDue,
    agency: r.agency ?? prev?.agency,
    contractValue: r.contract_value ?? prev?.contractValue,
    pipeline: {
      match: !!r.pipeline?.match, resume: !!r.pipeline?.resume,
      tables: !!r.pipeline?.tables, submit: !!r.pipeline?.submit,
    },
    coverage: {
      rolesTotal, rolesStaffed: r.roles_staffed ?? 0,
      slotsTotal: r.slots_total ?? 0, slotsFilled: r.slots_filled ?? 0,
    },
    plan: { sections: r.plan_sections ?? (rolesTotal > 0 ? ['staffing'] : []) },
    ...(r.decisions_open != null ? { decisionsOpen: r.decisions_open } : {}),
    ...(r.gate ? { gate: { status: r.gate.status, platformRef: r.gate.platform_ref ?? undefined, verifiedAt: r.gate.verified_at ?? undefined } } : {}),
    ...(r.discovery_event ? { discoveryEvent: { businessUnit: r.discovery_event.business_unit, eventId: r.discovery_event.event_id } } : {}),
    updatedAt: prev?.updatedAt ?? now,
  }
  // The legacy deadline key is read by consumers via bidDeadline(); never write it again.
  delete (next as Partial<BidStatusData>).deadlineProposalDue
  return next
}

export interface BidSyncOutcome {
  created: number
  updated: number
  unchanged: number
  changes: { folder: string; bidId: number; why: string }[]
}

/**
 * Mirror a batch of workbench rows into operations/bids. One lock, one commit.
 */
export async function syncBids(rows: RemoteBid[], via = 'bid-sync'): Promise<BidSyncOutcome> {
  const outcome: BidSyncOutcome = { created: 0, updated: 0, unchanged: 0, changes: [] }
  const release = await acquireLock(PATHS.bids)
  try {
    const existing = await readAllStatuses()
    const byBidId = new Map<number, Existing>()
    for (const e of existing) {
      if (e.data.source?.system === 'qual-table' && typeof e.data.source.bid_id === 'number') byBidId.set(e.data.source.bid_id, e)
    }
    const taken = new Set(existing.map(e => e.folder))
    const now = new Date().toISOString()
    const todayIso = today()

    for (const r of rows) {
      if (typeof r.bid_id !== 'number' || !r.display_name) continue
      const hit = byBidId.get(r.bid_id)
      let folder = hit?.folder
      if (!folder) {
        const base = bidFolderSlug(r.display_name, r.bid_id)
        // A markdown-era folder with the same name is a different bid until a
        // person links it by hand (gate 7: none exist today). Do not adopt it.
        folder = (taken.has(base) || await fileExists(path.join(PATHS.bids, base))) ? `${base}-qt${r.bid_id}` : base
        taken.add(folder)
      }

      const next = nextStatus(r, hit?.data, now, todayIso)
      if (hit && connectorView(hit.data) === connectorView(next)) { outcome.unchanged++; continue }

      next.updatedAt = now
      next.syncedAt = now
      await atomicWrite(path.join(PATHS.bids, folder, '.status.json'), JSON.stringify(next, null, 2) + '\n')

      const why = hit
        ? (hit.data.stage !== next.stage ? `${hit.data.stage ?? '?'} → ${next.stage}` : 'fields changed')
        : `new (${next.stage})`
      outcome.changes.push({ folder, bidId: r.bid_id, why })
      if (hit) outcome.updated++; else outcome.created++
    }

    // ONE commit for the batch. The janitor would sweep these anyway; committing
    // here gives the change a message that says what moved and who wrote it.
    if (outcome.created || outcome.updated) {
      const rel = path.relative(PATHS.operationsRoot, PATHS.bids)
      try {
        await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 30_000)
        await runCommandArgs('git', [
          '-C', PATHS.operationsRoot, 'commit', '-q',
          '-m', `bids: ${outcome.created} new, ${outcome.updated} updated`,
          '-m', outcome.changes.map(c => `${c.folder} (#${c.bidId}): ${c.why}`).join('\n') + `\nvia: ${via}`,
        ], 30_000)
      } catch { /* nothing staged, or git unavailable — janitor sweeps */ }
    }
  } finally {
    await release()
  }
  return outcome
}

/** Append one line to the run log. Never throws: a logging failure must not fail a sync. */
export async function appendBidSyncLog(line: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(PATHS.bidSyncLog), { recursive: true })
    await fs.appendFile(PATHS.bidSyncLog, `${new Date().toISOString()} ${line}\n`)
  } catch { /* see above */ }
}

/** ISO time of the last successful run, from the log; null when there is none. */
export async function lastBidSyncSuccess(): Promise<string | null> {
  try {
    const raw = await fs.readFile(PATHS.bidSyncLog, 'utf-8')
    const lines = raw.trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^(\S+) ok\b/.exec(lines[i])
      if (m) return m[1]
    }
    return null
  } catch {
    return null
  }
}
