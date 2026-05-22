import { getCronJobs } from '@/lib/shell'
import { PageHeader } from '@/components/shared/page-header'
import { CronJobList } from './cron-job-list'
import { Card, CardContent } from '@/components/ui/card'
import { Clock, Terminal } from 'lucide-react'
import type { CronJob } from '@/types'

export const dynamic = 'force-dynamic'

export default async function CronPage() {
  const cronJobs = await getCronJobs() as CronJob[]
  const failedCount = cronJobs.filter((j) => {
    const status = (j as any).state?.lastRunStatus
    return status === 'error' || status === 'failed'
  }).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cron Jobs"
        description={
          cronJobs.length === 0
            ? 'No scheduled tasks yet'
            : `${cronJobs.length} scheduled · ${failedCount} failing`
        }
        breadcrumbs={[
          { label: 'System', href: '/system' },
          { label: 'Cron Jobs' },
        ]}
      />
      {cronJobs.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="max-w-md mx-auto text-center space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Clock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">No cron jobs scheduled</h3>
                <p className="text-sm text-muted-foreground">
                  Scheduled tasks let OpenClaw run automated scans, intel pulls, and reports without you lifting a finger.
                </p>
              </div>
              <div className="rounded-md border border-border bg-card/50 p-4 text-left space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Terminal className="h-3.5 w-3.5" />
                  Add a task
                </div>
                <pre className="text-xs font-mono text-foreground overflow-x-auto">
                  <code>{`openclaw cron add \\
  --name "daily-intel-scan" \\
  --schedule "0 4 * * *" \\
  --task intel.daily`}</code>
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <CronJobList jobs={cronJobs} />
      )}
    </div>
  )
}
