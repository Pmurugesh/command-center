import Link from 'next/link'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { TimeAgo } from '@/components/shared/time-ago'
import { Card, CardContent } from '@/components/ui/card'
import { getAgents } from '@/lib/agents'
import {
  ArrowRight, Bot, Building2, FileText, Handshake, PenTool, Radio, Shield, type LucideIcon,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

// Map iconKey (string from lib/agents.ts AGENT_OUTPUTS) → LucideIcon component.
// Kept here so the data layer stays JSON-serializable.
const OUTPUT_ICONS: Record<string, LucideIcon> = {
  Shield,
  Radio,
  FileText,
  Building2,
  Handshake,
  PenTool,
}

export default async function AgentsPage() {
  const agents = await getAgents().catch(() => [])

  if (agents.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Agents"
          description="Your AI workforce"
        />
        <EmptyState
          icon={Bot}
          title="No agents configured"
          description="The dashboard reads `openclaw agents list`. Make sure the openclaw CLI is installed and at least one agent is configured."
        />
      </div>
    )
  }

  // Stable order: main first (orchestrator), then by name
  const sorted = [...agents].sort((a, b) => {
    if (a.id === 'main') return -1
    if (b.id === 'main') return 1
    return a.name.localeCompare(b.name)
  })

  const okCount = agents.filter(a => a.status === 'ok').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description={
          `${agents.length} agent${agents.length === 1 ? '' : 's'} configured` +
          (okCount > 0 ? ` · ${okCount} active in the last 24h` : '')
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sorted.map((agent) => (
          <Card
            key={agent.id}
            className={agent.id === 'main' ? 'border-blue-500/30 bg-blue-500/5' : ''}
          >
            <CardContent className="p-6 space-y-4">
              {/* Header: emoji + name + id, with status & model on the right */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-3xl flex-shrink-0">{agent.emoji || '🤖'}</span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold leading-tight truncate">{agent.name || agent.id}</h3>
                    <p className="text-xs text-muted-foreground font-mono tabular-nums truncate">{agent.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={agent.status} />
                  {agent.model && (
                    <span className={
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ' +
                      (agent.model.toLowerCase().includes('opus')
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30')
                    }>
                      {agent.model.toLowerCase().includes('opus') ? 'Opus' : 'Sonnet'}
                    </span>
                  )}
                </div>
              </div>

              {/* Role description */}
              {agent.role && (
                <p className="text-sm text-muted-foreground leading-relaxed">{agent.role}</p>
              )}

              {/* Outputs — clickable links to the routes this agent produces */}
              {agent.outputs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outputs</p>
                  <div className="flex flex-wrap gap-2">
                    {agent.outputs.map((output) => {
                      const Icon = OUTPUT_ICONS[output.iconKey] || ArrowRight
                      return (
                        <Link
                          key={output.href}
                          href={output.href}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-accent hover:border-status-accent/30 transition-colors group"
                        >
                          <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-status-accent transition-colors" />
                          {output.label}
                          <ArrowRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-status-accent transition-colors" />
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* SOUL.md ownership entries — context, not actionable */}
              {agent.owns.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors select-none">
                    Owns ({agent.owns.length})
                  </summary>
                  <ul className="space-y-1 pt-2 pl-1">
                    {agent.owns.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-muted-foreground/40 mt-0.5">·</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Footer: workspace + last activity */}
              <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-mono tabular-nums truncate">{agent.workspace}</span>
                {agent.lastActivityAt && (
                  <span className="text-muted-foreground flex-shrink-0">
                    Last activity <TimeAgo date={agent.lastActivityAt} />
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
