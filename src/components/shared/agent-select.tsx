'use client'

import { useEffect, useState } from 'react'
import type { Agent } from '@/types'

// Auto-discovers agents from /api/system/agents (reuses getAgents → `openclaw agents list`).
// Renders <select name="agent"> so the enclosing form's FormData picks it up. Falls back to
// just Paladin/main when the list is empty (e.g. openclaw not reachable in local dev).
export function AgentSelect({ className }: { className?: string }) {
  const [agents, setAgents] = useState<Agent[]>([])

  useEffect(() => {
    let active = true
    fetch('/api/system/agents')
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (active && Array.isArray(data)) setAgents(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const options = agents.length > 0 ? agents : [{ id: 'main', name: 'Paladin', emoji: '🧠' } as Agent]

  return (
    <label className="block text-xs text-muted-foreground">
      Handled by
      <select
        name="agent"
        defaultValue="main"
        className={
          className ??
          'mt-1 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'
        }
      >
        {options.map(a => (
          <option key={a.id} value={a.id}>
            {a.emoji} {a.name} ({a.id})
          </option>
        ))}
      </select>
    </label>
  )
}
