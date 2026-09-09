import { NextResponse } from 'next/server'
import { runCommandArgs, getNormalizedCronJobs } from '@/lib/shell'

export const dynamic = 'force-dynamic'

/**
 * Trigger one cron job now.
 *
 * `openclaw cron run` takes a **job id**, not a name — its own help says
 * `Usage: openclaw cron run [options] <id>`, and `install-roadmap-check.sh`
 * has always resolved the id before calling it. The Run Now button on
 * /system/cron passed `job.name`, so every press was a no-op that reported
 * success: the CLI got a name where it wanted a uuid.
 *
 * Rather than fix the caller, the route now accepts either and resolves a name
 * to an id here — one place, so the next caller cannot make the same mistake.
 * `/roadmap`'s rescore button is that next caller.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ref = params.id
    if (!ref || ref.includes('..') || ref.includes('/')) {
      return NextResponse.json({ error: 'Invalid job reference' }, { status: 400 })
    }

    // A uuid is already an id; anything else is treated as a name to resolve.
    let jobId = ref
    if (!/^[0-9a-f-]{16,}$/i.test(ref)) {
      const { reachable, jobs } = await getNormalizedCronJobs()
      if (!reachable) {
        return NextResponse.json(
          { success: false, error: 'openclaw is not reachable from this machine' },
          { status: 503 }
        )
      }
      const match = jobs.find(j => j.name === ref)
      if (!match) {
        return NextResponse.json({ success: false, error: `No cron job named "${ref}"` }, { status: 404 })
      }
      jobId = match.id
    }

    // Generous timeout: roadmap-check fetches six clones before it writes.
    const output = await runCommandArgs('openclaw', ['cron', 'run', jobId], 600_000)
    return NextResponse.json({ success: true, output })
  } catch (error) {
    console.error(`POST /api/system/cron/${params.id}/run error:`, error)
    return NextResponse.json(
      { success: false, error: 'Failed to run cron job' },
      { status: 500 }
    )
  }
}
