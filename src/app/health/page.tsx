import { listScanReports, currentScanReports } from '@/lib/files'
import { extractDeltaIndicators, extractCriticalCount } from '@/lib/markdown'
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
    <div className="space-y-3">
      <PageHeader
        title="Codebase Health"
        description={`${current.size} current scans · ${totalNew} new · ${totalResolved} resolved${totalCritical > 0 ? ` · ${totalCritical} critical` : ''}`}
      />

      {/* The four DataCards that were here rendered one integer each at
          text-4xl across 1,489px. The same numbers now ride in the header. */}
      {reports.length === 0 ? (
        <EmptyState icon={Shield} title="No scan reports found" description="Reports will appear here when scans are run" />
      ) : (
        <HealthReportList reports={reportsWithDeltas} currentNames={Array.from(current)} />
      )}
    </div>
  )
}
