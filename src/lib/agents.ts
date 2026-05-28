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
 *   warning — no output touched in 7+ days (or no outputs configured)
 *
 * This file replaces the inline logic that used to live in
 * src/app/api/system/agents/route.ts so the page can call it directly without
 * a server-to-server HTTP roundtrip.
 */

import fs from 'fs/promises'
import path from 'path'
import { runCommand } from './shell'
import { listBids, listScanReports, listIntelAlerts, listAgencies } from './files'
import { PATHS } from './paths'
import type { Agent, AgentOutput, AgentStatus } from '@/types'

const HOME = process.env.HOME || '/Users/paladin'

const AGENT_WORKSPACES: Record<string, string> = {
  main: path.join(HOME, '.openclaw/workspace'),
  product: path.join(HOME, 'agents/product'),
  sales: path.join(HOME, 'agents/sales'),
  intel: path.join(HOME, 'agents/intel'),
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
    { href: '/partnerships', label: 'Partnerships',  iconKey: 'Handshake' },
  ],
  main: [], // orchestrator — coordinates the others, no direct outputs
}

interface ParsedAgent {
  id: string
  name: string
  emoji: string
  model: string
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
      current = { id: agentMatch[1], name: '', emoji: '', model: '' }
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

function deriveStatus(lastActivityMs: number | undefined, agentId: string): AgentStatus {
  // Main agent is the orchestrator — no direct outputs, treat as ok if it's
  // configured at all (we always parsed it from `openclaw agents list`).
  if (agentId === 'main') return 'ok'

  if (lastActivityMs === undefined) return 'warning'  // configured but no outputs found

  const hoursAgo = (Date.now() - lastActivityMs) / (1000 * 60 * 60)
  if (hoursAgo < 24) return 'ok'
  if (hoursAgo < 24 * 7) return 'idle'
  return 'warning'
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
      const workspace = AGENT_WORKSPACES[agent.id] || ''
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
