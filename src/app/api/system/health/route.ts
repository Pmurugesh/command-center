import { NextResponse } from 'next/server'
import { getCronJobs } from '@/lib/shell'
import { listBids, listScanReports, listIntelAlerts } from '@/lib/files'
import { extractDeltaIndicators, extractCriticalCount } from '@/lib/markdown'
import type { SystemHealth } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [cronJobs, bids, reports, alerts] = await Promise.all([
      getCronJobs(),
      listBids(),
      listScanReports(),
      listIntelAlerts(),
    ])

    const jobs = cronJobs as Array<{ enabled?: boolean; state?: { lastRunStatus?: string } }>
    const cronFailed = jobs.filter(j => j.state?.lastRunStatus === 'error' || j.state?.lastRunStatus === 'failed').length
    const cronOk = cronFailed === 0

    let criticalFindings = 0
    for (const report of reports) {
      criticalFindings += extractCriticalCount(report.content)
    }

    let overall: SystemHealth['overall'] = 'green'
    if (cronFailed > 0 || criticalFindings > 0) overall = 'yellow'
    if (cronFailed > 2 || criticalFindings > 5) overall = 'red'

    const health: SystemHealth = {
      overall,
      cronOk,
      cronFailed,
      criticalFindings,
      activeBids: bids.length,
      recentAlerts: alerts.length,
    }

    return NextResponse.json(health)
  } catch (error) {
    console.error('GET /api/system/health error:', error)
    return NextResponse.json(
      { overall: 'red', cronOk: false, cronFailed: 0, criticalFindings: 0, activeBids: 0, recentAlerts: 0 },
      { status: 500 }
    )
  }
}
