import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bot, Crown } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface AgentData {
  id: string
  name: string
  emoji: string
  model: string
  workspace: string
  role: string
  owns: string[]
  status: string
}

function modelLabel(model: string) {
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  return model.split('/').pop() || model
}

function modelColor(model: string) {
  if (model.includes('opus')) return 'bg-blue-500/10 text-blue-400 border-blue-500/30'
  if (model.includes('sonnet')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
  if (model.includes('haiku')) return 'bg-amber-500/10 text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-400 border-slate-500/30'
}

async function getAgents(): Promise<AgentData[]> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const res = await fetch(`${base}/api/system/agents`, { cache: 'no-store' })
  if (!res.ok) return []
  return res.json()
}

export default async function AgentsPage() {
  const agents = await getAgents()
  const mainAgent = agents.find(a => a.id === 'main')
  const otherAgents = agents.filter(a => a.id !== 'main')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description={`${agents.length} agents configured`}
        breadcrumbs={[
          { label: 'System', href: '/system' },
          { label: 'Agents' },
        ]}
      />

      {agents.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="max-w-md mx-auto text-center space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">No agents found</h3>
                <p className="text-sm text-muted-foreground">
                  Could not reach OpenClaw or no agents are configured.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Main / Hub agent — visually distinguished */}
          {mainAgent && (
            <AgentCard agent={mainAgent} isMain />
          )}

          {/* Other agents in a grid */}
          {otherAgents.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {otherAgents.map(agent => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent, isMain = false }: { agent: AgentData; isMain?: boolean }) {
  return (
    <Card className={isMain ? 'border-blue-500/40 bg-blue-500/5' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-3xl flex-shrink-0">{agent.emoji}</span>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                {agent.name}
                {isMain && <Crown className="h-4 w-4 text-blue-400 flex-shrink-0" />}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{agent.role}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusBadge status={agent.status} />
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${modelColor(agent.model)}`}>
              {modelLabel(agent.model)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {agent.owns.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Owns</p>
            <ul className="space-y-1">
              {agent.owns.map((item, i) => (
                <li key={i} className="text-sm text-foreground/80 flex items-start gap-1.5">
                  <span className="text-muted-foreground mt-1.5 h-1 w-1 rounded-full bg-current flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs font-mono text-muted-foreground">{agent.workspace}</p>
      </CardContent>
    </Card>
  )
}
