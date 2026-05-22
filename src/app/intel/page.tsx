import { listIntelAlerts } from '@/lib/files'
import { DataCard } from '@/components/shared/data-card'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { TimeAgo } from '@/components/shared/time-ago'
import { IntelFeed } from './intel-feed'
import { Radio } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function IntelPage() {
  const alerts = await listIntelAlerts()

  const dailyAlerts = alerts.filter(a => a.type === 'daily')
  const weeklyBriefings = alerts.filter(a => a.type === 'weekly')
  const procurements = alerts.filter(a => a.type === 'procurement')
  const latest = alerts[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligence"
        description="Automated research scans and procurement alerts"
        actions={
          latest && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Radio className="h-4 w-4" />
              <span>Latest:</span>
              <span className="font-mono tabular-nums text-foreground">{latest.date}</span>
              <span className="text-muted-foreground">·</span>
              <TimeAgo date={latest.date} />
            </div>
          )
        }
      />

      {/* Three count cards (dropped 'Latest' — it's now a header pill) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DataCard label="Daily Alerts"     value={dailyAlerts.length}     subtitle="Daily scans" />
        <DataCard label="Weekly Briefings" value={weeklyBriefings.length} subtitle="Strategic rollups" />
        <DataCard label="Procurements"     value={procurements.length}    subtitle="Pipeline opportunities" />
      </div>

      {alerts.length === 0 ? (
        <EmptyState icon={Radio} title="No intelligence alerts" description="Alerts will appear when scans generate reports" />
      ) : (
        <IntelFeed
          dailyAlerts={dailyAlerts}
          weeklyBriefings={weeklyBriefings}
          procurements={procurements}
        />
      )}
    </div>
  )
}
