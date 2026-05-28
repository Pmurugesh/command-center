import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { runCommand } from '@/lib/shell'

export const dynamic = 'force-dynamic'

const HOME = process.env.HOME || '/Users/paladin'

interface AgentInfo {
  id: string
  name: string
  emoji: string
  model: string
  workspace: string
  role: string
  owns: string[]
  status: 'ok' | 'idle'
}

const AGENT_WORKSPACES: Record<string, string> = {
  main: path.join(HOME, '.openclaw/workspace'),
  product: path.join(HOME, 'agents/product'),
  sales: path.join(HOME, 'agents/sales'),
  intel: path.join(HOME, 'agents/intel'),
}

function parseAgentsList(output: string): Array<{ id: string; name: string; emoji: string; model: string }> {
  const agents: Array<{ id: string; name: string; emoji: string; model: string }> = []
  let currentAgent: { id: string; name: string; emoji: string; model: string } | null = null

  for (const line of output.split('\n')) {
    const agentMatch = line.match(/^- (\w+)/)
    if (agentMatch) {
      if (currentAgent) agents.push(currentAgent)
      currentAgent = { id: agentMatch[1], name: '', emoji: '', model: '' }
      continue
    }
    if (!currentAgent) continue

    const identityMatch = line.match(/Identity:\s*(\S+)\s+(\S+)/)
    if (identityMatch) {
      currentAgent.emoji = identityMatch[1]
      currentAgent.name = identityMatch[2]
    }

    const modelMatch = line.match(/Model:\s*(.+)/)
    if (modelMatch) {
      currentAgent.model = modelMatch[1].trim()
    }
  }
  if (currentAgent) agents.push(currentAgent)
  return agents
}

async function readSoulMd(workspace: string): Promise<{ role: string; owns: string[] }> {
  const soulPath = path.join(workspace, 'SOUL.md')
  try {
    const content = await fs.readFile(soulPath, 'utf-8')

    // Extract role: first paragraph under "Who You Are"
    let role = ''
    const whoMatch = content.match(/##\s*Who You Are\n+([\s\S]*?)(?=\n##|\n$)/)
    if (whoMatch) {
      role = whoMatch[1].split('\n').filter(l => l.trim()).slice(0, 1).join(' ').trim()
    }
    // Fallback: for main agent, use the Core Identity description
    if (!role) {
      const coreMatch = content.match(/\*\*Role:\*\*\s*(.+)/)
      if (coreMatch) role = coreMatch[1].trim()
    }

    // Extract "What You Own" bullet list
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

export async function GET() {
  try {
    const output = await runCommand('openclaw agents list', 15000)
    const parsed = parseAgentsList(output)

    const agents: AgentInfo[] = await Promise.all(
      parsed.map(async (agent) => {
        const workspace = AGENT_WORKSPACES[agent.id] || ''
        const { role, owns } = workspace ? await readSoulMd(workspace) : { role: '', owns: [] }

        return {
          id: agent.id,
          name: agent.name,
          emoji: agent.emoji,
          model: agent.model,
          workspace: workspace.replace(HOME, '~'),
          role,
          owns,
          status: agent.id === 'main' ? 'ok' as const : 'idle' as const,
        }
      })
    )

    return NextResponse.json(agents)
  } catch (error) {
    console.error('GET /api/system/agents error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}
