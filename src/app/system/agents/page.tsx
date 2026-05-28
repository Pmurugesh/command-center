import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'

interface Agent {
  id: string
  name: string
  emoji: string
  model: string
  workspace: string
  role: string
  owns: string[]
  status: string
}

async function getAgents(): Promise<Agent[]> {
  const res = await fetch('http://localhost:3000/api/system/agents', { cache: 'no-store' })
  if (!res.ok) return []
  return res.json()
}

export default async function AgentsPage() {
  const agents = await getAgents()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        subtitle={`${agents.length} agents configured`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`rounded-lg border p-6 space-y-4 ${
              agent.id === 'main'
                ? 'border-blue-500/30 bg-blue-500/5'
                : 'border-border bg-card'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{agent.emoji}</span>
                <div>
                  <h3 className="text-lg font-bold">{agent.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">{agent.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={agent.status === 'ok' ? 'ok' : agent.status === 'idle' ? 'idle' : 'error'} />
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  agent.model.includes('opus')
                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {agent.model.includes('opus') ? 'Opus' : 'Sonnet'}
                </span>
              </div>
            </div>

            {agent.role && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {agent.role}
              </p>
            )}

            {agent.owns.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Owns</p>
                <ul className="space-y-1">
                  {agent.owns.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-muted-foreground/50 mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground font-mono">{agent.workspace}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
