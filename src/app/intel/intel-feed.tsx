"use client"

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { EmptyState } from '@/components/shared/empty-state'
import { ChevronDown, ChevronRight, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { hasCriticalContent } from '@/lib/markdown'
import type { IntelAlert } from '@/types'

type TabType = 'daily' | 'weekly' | 'procurement'

interface IntelFeedProps {
  dailyAlerts: IntelAlert[]
  weeklyBriefings: IntelAlert[]
  procurements: IntelAlert[]
}

export function IntelFeed({ dailyAlerts, weeklyBriefings, procurements }: IntelFeedProps) {
  const [activeTab, setActiveTab] = useState<TabType>('daily')
  const [expanded, setExpanded] = useState<string | null>(null)

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: 'daily', label: 'Daily Alerts', count: dailyAlerts.length },
    { key: 'weekly', label: 'Weekly Briefings', count: weeklyBriefings.length },
    { key: 'procurement', label: 'Procurements', count: procurements.length },
  ]

  const currentAlerts = activeTab === 'daily' ? dailyAlerts :
    activeTab === 'weekly' ? weeklyBriefings : procurements

  // Auto-expand first alert when switching tabs
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const alerts = tab === 'daily' ? dailyAlerts :
      tab === 'weekly' ? weeklyBriefings : procurements
    setExpanded(alerts[0]?.filename || null)
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm transition-colors border-b-2",
              activeTab === tab.key
                ? "text-foreground border-blue-400"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            {tab.label}
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{tab.count}</Badge>
          </button>
        ))}
      </div>

      {/* Alert list */}
      {currentAlerts.length === 0 ? (
        <EmptyState icon={Radio} title={`No ${activeTab} alerts`} />
      ) : (
        <div className="space-y-4">
          {currentAlerts.map((alert) => {
            const hasCritical = hasCriticalContent(alert.content)
            return (
              <Card key={alert.filename}>
                <CardHeader
                  className="cursor-pointer"
                  onClick={() => setExpanded(expanded === alert.filename ? null : alert.filename)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {expanded === alert.filename ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Radio className="h-4 w-4" />
                          {alert.date || 'Undated'} — {alert.type === 'daily' ? 'Daily Scan' : alert.type === 'weekly' ? 'Weekly Briefing' : 'Procurement'}
                        </CardTitle>
                        <CardDescription>{alert.filename}</CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {hasCritical && <Badge variant="destructive">Critical</Badge>}
                    </div>
                  </div>
                </CardHeader>
                {expanded === alert.filename && (
                  <CardContent>
                    <div className="rounded-lg border border-border p-4 bg-background max-h-[600px] overflow-y-auto">
                      <MarkdownRenderer content={alert.content} />
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
