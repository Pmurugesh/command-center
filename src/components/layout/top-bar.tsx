"use client"

import { useSystemHealth } from '@/hooks/use-system-status'
import { HealthDot } from '@/components/shared/status-badge'
import { Clock } from 'lucide-react'
import { useState, useEffect } from 'react'

export function TopBar() {
  const { data: health } = useSystemHealth()
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      setTime(new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }))
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="h-10 border-b border-border bg-card flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {health && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HealthDot status={health.overall} />
            <span>System {health.overall === 'green' ? 'Healthy' : health.overall === 'yellow' ? 'Warning' : 'Critical'}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {time}
      </div>
    </div>
  )
}
