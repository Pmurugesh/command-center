import { NextResponse } from 'next/server'
import { runCommandArgs } from '@/lib/shell'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const jobName = params.id
    if (!jobName || jobName.includes('..') || jobName.includes('/')) {
      return NextResponse.json({ error: 'Invalid job name' }, { status: 400 })
    }

    const output = await runCommandArgs('openclaw', ['cron', 'run', jobName], 30000)
    return NextResponse.json({ success: true, output })
  } catch (error) {
    console.error(`POST /api/system/cron/${params.id}/run error:`, error)
    return NextResponse.json(
      { success: false, error: 'Failed to run cron job' },
      { status: 500 }
    )
  }
}
