"use client"

import { useSystemHealth } from '@/hooks/use-system-status'
import { HealthDot } from '@/components/shared/status-badge'
import { MobileNav } from '@/components/layout/mobile-nav'
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
    <div className="flex h-12 items-center justify-between border-b border-border bg-card px-2 md:h-10 md:px-4">
      <div className="flex items-center gap-1 md:gap-3">
        <MobileNav />
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
