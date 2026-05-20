import { listScanReports } from '@/lib/files'
import { extractDeltaIndicators, extractCriticalCount } from '@/lib/markdown'
import { DataCard } from '@/components/shared/data-card'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { HealthReportList } from './health-report-list'
import { Shield } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const reports = await listScanReports()

  const reportsWithDeltas = reports.map((report) => ({
    ...report,
    deltas: extractDeltaIndicators(report.content),
    criticalCount: extractCriticalCount(report.content),
  }))

  const totalNew = reportsWithDeltas.reduce((s, r) => s + r.deltas.new, 0)
  const totalResolved = reportsWithDeltas.reduce((s, r) => s + r.deltas.resolved, 0)
  const totalCritical = reportsWithDeltas.reduce((s, r) => s + r.criticalCount, 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Codebase Health" description="Automated scan reports and findings" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <DataCard label="Total Reports" value={reports.length} />
        <DataCard label="New Findings" value={totalNew} valueColor="text-red-400" />
        <DataCard label="Resolved" value={totalResolved} valueColor="text-emerald-400" />
        <DataCard label="Critical" value={totalCritical} valueColor={totalCritical > 0 ? 'text-red-400' : 'text-emerald-400'} />
      </div>

      {reports.length === 0 ? (
        <EmptyState icon={Shield} title="No scan reports found" description="Reports will appear here when scans are run" />
      ) : (
        <HealthReportList reports={reportsWithDeltas} />
      )}
    </div>
  )
}
