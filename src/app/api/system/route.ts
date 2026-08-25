import { NextResponse } from 'next/server'
import { getCronJobs, getOpenClawStatus, getActiveClaudeProcesses } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [openclaw, cron, activeProcesses] = await Promise.all([
      getOpenClawStatus(),
      getCronJobs(),
      getActiveClaudeProcesses(),
    ])
    // `cronJobs` stays a raw array for existing consumers; `cronReachable`
    // tells them whether an empty array means "none" or "couldn't look".
    return NextResponse.json({
      openclaw,
      cronReachable: cron.reachable,
      cronJobs: cron.raw,
      activeProcesses,
    })
  } catch (error) {
    console.error('GET /api/system error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch system status', openclaw: '', cronReachable: false, cronJobs: [], activeProcesses: 0 },
      { status: 500 }
    )
  }
}
