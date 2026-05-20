import { listIntelAlerts } from '@/lib/files'
import { DataCard } from '@/components/shared/data-card'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { IntelFeed } from './intel-feed'
import { Radio } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function IntelPage() {
  const alerts = await listIntelAlerts()

  const dailyAlerts = alerts.filter(a => a.type === 'daily')
  const weeklyBriefings = alerts.filter(a => a.type === 'weekly')
  const procurements = alerts.filter(a => a.type === 'procurement')

  return (
    <div className="space-y-6">
      <PageHeader title="Intelligence" description="Automated research scans and procurement alerts" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <DataCard label="Daily Alerts" value={dailyAlerts.length} />
        <DataCard label="Weekly Briefings" value={weeklyBriefings.length} />
        <DataCard label="Procurements" value={procurements.length} />
        <DataCard label="Latest" value={alerts[0]?.date || 'N/A'} />
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
