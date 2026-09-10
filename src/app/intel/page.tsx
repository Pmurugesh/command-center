import { listIntelAlerts } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { TimeAgo } from '@/components/shared/time-ago'
import { hasCriticalContent, extractDeltaIndicators, extractExecutiveSummary } from '@/lib/markdown'
import { IntelFeed, type AlertSignal } from './intel-feed'
import { Radio } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function IntelPage() {
  const alerts = await listIntelAlerts()
  const latest = alerts[0]

  // Per-alert signal, computed once on the server. This is what turns the index
  // from a list of filenames into something worth scanning.
  const signals: Record<string, AlertSignal> = {}
  for (const a of alerts) {
    signals[a.filename] = {
      filename: a.filename,
      critical: hasCriticalContent(a.content),
      deltas: extractDeltaIndicators(a.content),
      summary: extractExecutiveSummary(a.content).slice(0, 200),
    }
  }
  const criticalCount = Object.values(signals).filter(s => s.critical).length

  return (
    <div className="space-y-3">
      <PageHeader
        title="Intelligence"
        description={`${alerts.length} reports${criticalCount > 0 ? ` · ${criticalCount} critical` : ''}`}
        actions={
          latest && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Radio className="h-4 w-4" />
              <span>Latest</span>
              <span className="font-mono tabular-nums text-foreground">{latest.date}</span>
              <span>·</span>
              <TimeAgo date={latest.date} />
            </div>
          )
        }
      />

      {/* The three DataCards that used to sit here restated the tab counts
          verbatim — 130px of duplication. The counts live on the tabs. */}
      {alerts.length === 0 ? (
        <EmptyState icon={Radio} title="No intelligence alerts" description="Alerts will appear when scans generate reports" />
      ) : (
        <IntelFeed alerts={alerts} signals={signals} />
      )}
    </div>
  )
}
