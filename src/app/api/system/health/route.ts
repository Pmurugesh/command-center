import { NextResponse } from 'next/server'
import { getNormalizedCronJobs } from '@/lib/shell'
import { isFailing } from '@/lib/cron'
import { listBids, listScanReports, listIntelAlerts, currentScanReports } from '@/lib/files'
import { extractCriticalCount } from '@/lib/markdown'
import type { SystemHealth } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [cronJobs, bids, reports, alerts] = await Promise.all([
      getNormalizedCronJobs(),
      listBids(),
      listScanReports(),
      listIntelAlerts(),
    ])

    const failing = cronJobs.filter(isFailing)
    const cronFailed = failing.length
    const cronOk = cronFailed === 0
    const persistentFailure = failing.some(j => j.consecutiveErrors >= 2)

    // Critical findings from the latest run of each scan only — informational,
    // shown on /health. They do NOT drive the global health dot: a codebase
    // finding is work to schedule, not an operational outage.
    let criticalFindings = 0
    for (const report of currentScanReports(reports)) {
      criticalFindings += extractCriticalCount(report.content)
    }

    // The dot means "is the automation running?": red for persistent or
    // widespread cron failure, yellow for a single fresh failure, else green.
    let overall: SystemHealth['overall'] = 'green'
    if (cronFailed > 0) overall = 'yellow'
    if (persistentFailure || cronFailed >= 2) overall = 'red'

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
