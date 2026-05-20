import { NextResponse } from 'next/server'
import { getCronJobs, getOpenClawStatus, getActiveClaudeProcesses } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [openclaw, cronJobs, activeProcesses] = await Promise.all([
      getOpenClawStatus(),
      getCronJobs(),
      getActiveClaudeProcesses(),
    ])
    return NextResponse.json({ openclaw, cronJobs, activeProcesses })
  } catch (error) {
    console.error('GET /api/system error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch system status', openclaw: '', cronJobs: [], activeProcesses: 0 },
      { status: 500 }
    )
  }
}
