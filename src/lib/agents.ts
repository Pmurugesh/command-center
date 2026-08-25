/**
 * Agent data layer.
 *
 * Parses the output of `openclaw agents list` (one block per agent: identity emoji,
 * name, model), then reads each agent's SOUL.md to extract its role + "What You Own"
 * list. Maps each agent to the dashboard routes that show its outputs.
 *
 * Status is derived from the most-recent mtime across the agent's owned outputs:
 *   ok      — output touched in the last 24h
 *   idle    — output touched in the last 1–7 days
 *   warning — the agent HAS a tracked output and it has gone 7+ days untouched
 *   unknown — the dashboard tracks no output for this agent, so freshness is
 *             unmeasured. This is deliberately NOT 'warning': "I don't watch
 *             this" and "this is stale" are different claims, and collapsing
 *             them is what made voice/scribe look broken when they were fine.
 *
 * This file replaces the inline logic that used to live in
 * src/app/api/system/agents/route.ts so the page can call it directly without
 * a server-to-server HTTP roundtrip.
 */

import fs from 'fs/promises'
import path from 'path'
import { runCommand, getNormalizedCronJobs } from './shell'
import { isFailing } from './cron'
import { listBids, listScanReports, listIntelAlerts, listAgencies } from './files'
import { PATHS } from './paths'
import type { Agent, AgentOutput, AgentStatus } from '@/types'

const HOME = process.env.HOME || '/Users/paladin'

// Fallback roots for an agent workspace, used only when the CLI doesn't report
// one. `~/agents/<id>` is the symlink farm; the operations repo is what those
// symlinks point at and also holds agents that were never linked (scribe).
const WORKSPACE_ROOTS = [
  path.join(HOME, 'agents'),
  path.join(HOME, 'repos/operations/agents'),
]

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p
}

/**
 * Resolve an agent's workspace.
 *
 * `openclaw agents list` reports `Workspace:` per agent, and that is the
 * authoritative answer — it tracks agents wherever they actually live
 * (voice under ~/agents, scribe straight out of the operations repo) with no
 * guessing here. The probe is only a fallback for a CLI that doesn't print it.
 * Either way nothing is hardcoded per-agent, so a newly-added agent is
 * discovered rather than silently rendered blank — CLAUDE.md, "auto-discover
 * it. No manual wiring."
 */
async function findWorkspace(agentId: string, reported: string): Promise<string> {
  if (reported) {
    const abs = expandHome(reported)
    try {
      if ((await fs.stat(abs)).isDirectory()) return abs
    } catch { /* CLI pointed somewhere gone — fall through to the probe */ }
  }
  if (agentId === 'main') return path.join(HOME, '.openclaw/workspace')
  for (const root of WORKSPACE_ROOTS) {
    const candidate = path.join(root, agentId)
    try {
      // stat() follows symlinks, which is what we want: ~/agents/<id> is a link.
      const st = await fs.stat(candidate)
      if (st.isDirectory()) return candidate
    } catch { /* try the next root */ }
  }
  return ''
}

// Agent → dashboard outputs. iconKey is a string the rendering side maps to a
// LucideIcon, keeping this file JSON-safe.
const AGENT_OUTPUTS: Record<string, AgentOutput[]> = {
  product: [
    { href: '/health', label: 'Codebase Health', iconKey: 'Shield' },
  ],
  intel: [
    { href: '/intel', label: 'Intelligence', iconKey: 'Radio' },
  ],
  sales: [
    { href: '/bids',         label: 'Bid Pipeline',  iconKey: 'FileText' },
    { href: '/agencies',     label: 'Agencies',      iconKey: 'Building2' },
    { href: '/channels',     label: 'Channels',      iconKey: 'Handshake' },
  ],
  main: [], // orchestrator — coordinates the others, no direct outputs
}

interface ParsedAgent {
  id: string
  name: string
  emoji: string
  model: string
  workspace: string   // as reported by the CLI; '' when it didn't say
}

// Parse `openclaw agents list` output. Each agent block starts with "- <id>"
// and includes "Identity: <emoji> <name>" and "Model: <model>" lines.
function parseAgentsList(output: string): ParsedAgent[] {
  const agents: ParsedAgent[] = []
  let current: ParsedAgent | null = null

  for (const line of output.split('\n')) {
    const agentMatch = line.match(/^- (\w+)/)
    if (agentMatch) {
      if (current) agents.push(current)
      current = { id: agentMatch[1], name: '', emoji: '', model: '', workspace: '' }
      continue
    }
    if (!current) continue

    const identityMatch = line.match(/Identity:\s*(\S+)\s+(\S+)/)
    if (identityMatch) {
      current.emoji = identityMatch[1]
      current.name = identityMatch[2]
    }

    const modelMatch = line.match(/Model:\s*(.+)/)
    if (modelMatch) {
      current.model = modelMatch[1].trim()
    }

    // "Workspace: ~/agents/voice" — note this must not match "Agent dir:".
    const workspaceMatch = line.match(/^\s*Workspace:\s*(.+)/)
    if (workspaceMatch) {
      current.workspace = workspaceMatch[1].trim()
    }
  }
  if (current) agents.push(current)
  return agents
}

async function readSoulMd(workspace: string): Promise<{ role: string; owns: string[] }> {
  const soulPath = path.join(workspace, 'SOUL.md')
  try {
    const content = await fs.readFile(soulPath, 'utf-8')

    // Role: first non-empty line under "## Who You Are"
    let role = ''
    const whoMatch = content.match(/##\s*Who You Are\n+([\s\S]*?)(?=\n##|\n$)/)
    if (whoMatch) {
      role = whoMatch[1].split('\n').filter(l => l.trim()).slice(0, 1).join(' ').trim()
    }
    // Fallback for main agent's Core Identity format
    if (!role) {
      const coreMatch = content.match(/\*\*Role:\*\*\s*(.+)/)
      if (coreMatch) role = coreMatch[1].trim()
    }

    // Owns: bullet list under "## What You Own"
    const owns: string[] = []
    const ownsMatch = content.match(/##\s*What You Own\n+([\s\S]*?)(?=\n##|\n$)/)
    if (ownsMatch) {
      for (const line of ownsMatch[1].split('\n')) {
        const bullet = line.match(/^-\s+(.+)/)
        if (bullet) owns.push(bullet[1].trim())
      }
    }

    return { role, owns }
  } catch {
    return { role: '', owns: [] }
  }
}

// Most-recent mtime across an agent's owned outputs.
async function getLastActivityMs(agentId: string): Promise<number | undefined> {
  const mtimes: number[] = []

  if (agentId === 'product') {
    const reports = await listScanReports()
    for (const r of reports) mtimes.push(new Date(r.lastModified).getTime())
  }

  if (agentId === 'intel') {
    // Read mtime from each alert file directly — `IntelAlert.date` is only the
    // date prefix from the filename, not a true timestamp.
    try {
      const files = await fs.readdir(PATHS.intelligence)
      for (const f of files) {
        if (!f.endsWith('.md')) continue
        try {
          const stat = await fs.stat(path.join(PATHS.intelligence, f))
          mtimes.push(stat.mtimeMs)
        } catch { /* skip unreadable */ }
      }
    } catch { /* alerts dir may not exist yet */ }
    // Also count whatever listIntelAlerts() found (covers weekly/, procurements/, etc.)
    const alerts = await listIntelAlerts()
    for (const a of alerts) {
      if (a.date) mtimes.push(new Date(a.date).getTime())
    }
  }

  if (agentId === 'scribe') {
    // Scribe's job is one filing pass over staged mail — its product is the
    // review queue, so that directory's freshness IS its activity.
    try {
      const files = await fs.readdir(PATHS.crmIntakeReview)
      for (const f of files) {
        try {
          const stat = await fs.stat(path.join(PATHS.crmIntakeReview, f))
          mtimes.push(stat.mtimeMs)
        } catch { /* skip unreadable */ }
      }
    } catch { /* intake dir may not exist on this machine */ }
  }

  if (agentId === 'sales') {
    const bids = await listBids()
    for (const b of bids) {
      if (b.updatedAt) mtimes.push(new Date(b.updatedAt).getTime())
    }
    const agencies = await listAgencies()
    for (const a of agencies) mtimes.push(new Date(a.lastModified).getTime())
    // Partnership tracker is a single file — use its mtime if present
    try {
      const trackerStat = await fs.stat(path.join(PATHS.partnerships, 'tracker.md'))
      mtimes.push(trackerStat.mtimeMs)
    } catch { /* tracker may not exist */ }
  }

  if (mtimes.length === 0) return undefined
  return Math.max(...mtimes)
}

// Agents whose freshness getLastActivityMs() actually knows how to measure.
// An agent outside this set isn't unhealthy — it's unwatched, and the UI must
// say so rather than flying an amber flag the operator can never clear.
const TRACKED_AGENTS = new Set(['product', 'intel', 'sales', 'scribe'])

function deriveStatus(lastActivityMs: number | undefined, agentId: string): AgentStatus {
  // Main agent is the orchestrator — no direct outputs, treat as ok if it's
  // configured at all (we always parsed it from `openclaw agents list`).
  if (agentId === 'main') return 'ok'

  // No tracked output → unmeasured, not stale.
  if (!TRACKED_AGENTS.has(agentId)) return 'unknown'

  // Tracked, but its output directory turned up empty — that IS worth a flag.
  if (lastActivityMs === undefined) return 'warning'

  const hoursAgo = (Date.now() - lastActivityMs) / (1000 * 60 * 60)
  if (hoursAgo < 24) return 'ok'
  if (hoursAgo < 24 * 7) return 'idle'
  return 'warning'
}

// Fallback for cron jobs missing an agentId: name → agent id by substring.
// The openclaw CLI reports agentId directly on each job; prefer that.
const CRON_NAME_TO_AGENT: { pattern: RegExp; agentId: string }[] = [
  // product (engineering / codebase)
  { pattern: /vulnerability-scan|test-coverage|tech-debt|migration-safety|compliance-(backend|ui)|rbac-consistency|doc-freshness|prompt-quality|dependency-config|audit-log/i, agentId: 'product' },
  // intel (research / alerts)
  { pattern: /intel|briefing|procurement|competitor|policy-scan|update-memory/i, agentId: 'intel' },
  // sales (bids / agencies / partnerships)
  { pattern: /bid|agency|agencies|partnership|outreach|response-/i, agentId: 'sales' },
]

function cronJobToAgentId(jobName: string): string {
  for (const { pattern, agentId } of CRON_NAME_TO_AGENT) {
    if (pattern.test(jobName)) return agentId
  }
  return 'other'
}

export interface AgentSummary {
  agentId: string                // 'main' | 'product' | 'intel' | 'sales' | 'voice' | 'other'
  agentName: string
  emoji: string
  runs: number                   // jobs that ran in the last 24h
  failed: number                 // of those, how many failed
  outputsTouched: number         // owned outputs whose mtime is within 24h
  lastActivityAt?: string
  // Jobs currently in a failed state (regardless of the 24h window) — a job
  // that broke yesterday and hasn't recovered still needs attention today.
  failures: { jobName: string; error?: string; consecutiveErrors: number }[]
}

/**
 * 24-hour activity summary per agent. Used by the Today page to surface
 * "what your AI workforce did overnight" without requiring per-run logs.
 *
 * Data sources:
 *   - getCronJobs() → cron run state (lastRunStatus, lastRunAt)
 *   - getLastActivityMs(agent) → max mtime across owned outputs
 *
 * Each agent's `runs` and `failed` come from cron jobs that map to that agent
 * via CRON_NAME_TO_AGENT. `outputsTouched` is the count of owned outputs whose
 * mtime is within the last 24h. If openclaw/cron isn't reachable, the cron-
 * based fields are 0 and the function still returns a valid array.
 */
export async function getAgent24hSummary(): Promise<AgentSummary[]> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000

  const [agents, cron] = await Promise.all([
    getAgents().catch(() => [] as Agent[]),
    getNormalizedCronJobs().catch(() => ({ reachable: false, jobs: [] })),
  ])
  const cronJobs = cron.jobs

  // Index cron jobs by agent id for quick aggregation.
  const cronByAgent: Record<string, {
    runs: number
    failed: number
    latest?: number
    failures: AgentSummary['failures']
  }> = {}
  const bucket = (agentId: string) => {
    if (!cronByAgent[agentId]) cronByAgent[agentId] = { runs: 0, failed: 0, failures: [] }
    return cronByAgent[agentId]
  }

  for (const job of cronJobs) {
    const agentId = job.agentId || cronJobToAgentId(job.name)
    const entry = bucket(agentId)

    // Any currently-failing job is surfaced even if its last run predates the window.
    if (isFailing(job)) {
      entry.failures.push({
        jobName: job.name,
        error: job.lastError,
        consecutiveErrors: job.consecutiveErrors,
      })
    }

    if (!job.lastRunAt) continue
    const ts = new Date(job.lastRunAt).getTime()
    if (Number.isNaN(ts) || ts < cutoff) continue

    entry.runs += 1
    if (isFailing(job)) entry.failed += 1
    if (!entry.latest || ts > entry.latest) entry.latest = ts
  }

  // Outputs touched within 24h, per agent.
  // Reuses the same per-agent mtime gathering as getLastActivityMs but counts
  // entries above the cutoff instead of taking the max.
  const outputsTouched = await Promise.all(
    agents.map(async (a) => ({
      agentId: a.id,
      count: await countOutputsSince(a.id, cutoff),
    }))
  )
  const touchedById = Object.fromEntries(outputsTouched.map(x => [x.agentId, x.count]))

  const summaries: AgentSummary[] = agents.map(a => {
    const cron = cronByAgent[a.id] || { runs: 0, failed: 0, failures: [] }
    const lastMs = Math.max(cron.latest || 0, a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0)
    return {
      agentId: a.id,
      agentName: a.name,
      emoji: a.emoji,
      runs: cron.runs,
      failed: cron.failed,
      outputsTouched: touchedById[a.id] || 0,
      lastActivityAt: lastMs > 0 ? new Date(lastMs).toISOString() : undefined,
      failures: cron.failures,
    }
  })

  // If openclaw isn't installed at all (agents is empty) but cron has entries,
  // surface them under their inferred agent id so we don't lose the signal.
  if (agents.length === 0) {
    for (const [agentId, cron] of Object.entries(cronByAgent)) {
      summaries.push({
        agentId,
        agentName: agentId,
        emoji: '🤖',
        runs: cron.runs,
        failed: cron.failed,
        outputsTouched: 0,
        lastActivityAt: cron.latest ? new Date(cron.latest).toISOString() : undefined,
        failures: cron.failures,
      })
    }
  }

  // Stable order: main first, then by name
  summaries.sort((a, b) => {
    if (a.agentId === 'main') return -1
    if (b.agentId === 'main') return 1
    return a.agentName.localeCompare(b.agentName)
  })

  return summaries
}

// Count an agent's owned outputs whose mtime is at or after `sinceMs`.
async function countOutputsSince(agentId: string, sinceMs: number): Promise<number> {
  let count = 0

  if (agentId === 'product') {
    const reports = await listScanReports()
    for (const r of reports) {
      if (new Date(r.lastModified).getTime() >= sinceMs) count += 1
    }
  }
  if (agentId === 'intel') {
    try {
      const files = await fs.readdir(PATHS.intelligence)
      for (const f of files) {
        if (!f.endsWith('.md')) continue
        try {
          const stat = await fs.stat(path.join(PATHS.intelligence, f))
          if (stat.mtimeMs >= sinceMs) count += 1
        } catch { /* skip */ }
      }
    } catch { /* dir may not exist */ }
  }
  if (agentId === 'scribe') {
    // Same output as getLastActivityMs(), counted rather than max'd.
    try {
      const files = await fs.readdir(PATHS.crmIntakeReview)
      for (const f of files) {
        try {
          const stat = await fs.stat(path.join(PATHS.crmIntakeReview, f))
          if (stat.mtimeMs >= sinceMs) count += 1
        } catch { /* skip unreadable */ }
      }
    } catch { /* intake dir may not exist on this machine */ }
  }

  if (agentId === 'sales') {
    const bids = await listBids()
    for (const b of bids) {
      if (b.updatedAt && new Date(b.updatedAt).getTime() >= sinceMs) count += 1
    }
    const agencies = await listAgencies()
    for (const a of agencies) {
      if (new Date(a.lastModified).getTime() >= sinceMs) count += 1
    }
    try {
      const trackerStat = await fs.stat(path.join(PATHS.partnerships, 'tracker.md'))
      if (trackerStat.mtimeMs >= sinceMs) count += 1
    } catch { /* tracker may not exist */ }
  }
  return count
}

/**
 * Get the full agent roster with derived status and linked outputs.
 * Throws on shell failure — callers should catch.
 */
export async function getAgents(): Promise<Agent[]> {
  const output = await runCommand('openclaw agents list', 15000)
  const parsed = parseAgentsList(output)

  return Promise.all(
    parsed.map(async (agent) => {
      const workspace = await findWorkspace(agent.id, agent.workspace)
      const { role, owns } = workspace ? await readSoulMd(workspace) : { role: '', owns: [] }
      const lastMs = await getLastActivityMs(agent.id)
      const status = deriveStatus(lastMs, agent.id)
      const outputs = AGENT_OUTPUTS[agent.id] || []

      return {
        id: agent.id,
        name: agent.name,
        emoji: agent.emoji,
        model: agent.model,
        workspace: workspace.replace(HOME, '~'),
        role,
        owns,
        outputs,
        status,
        lastActivityAt: lastMs ? new Date(lastMs).toISOString() : undefined,
      }
    })
  )
}
