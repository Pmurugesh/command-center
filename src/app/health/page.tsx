import { listScanReports, currentScanReports } from '@/lib/files'
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

  // Totals come from the latest run of each scan only — summing across dated
  // re-runs of the same scan counts findings that later runs already resolved.
  const current = new Set(currentScanReports(reports).map(r => r.name))
  const currentWithDeltas = reportsWithDeltas.filter(r => current.has(r.name))
  const totalNew = currentWithDeltas.reduce((s, r) => s + r.deltas.new, 0)
  const totalResolved = currentWithDeltas.reduce((s, r) => s + r.deltas.resolved, 0)
  const totalCritical = currentWithDeltas.reduce((s, r) => s + r.criticalCount, 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Codebase Health" description="Automated scan reports and findings · stats reflect the latest run of each scan" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <DataCard label="Reports" value={reports.length} subtitle={`${current.size} current scans`} />
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
