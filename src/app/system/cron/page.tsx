import { getNormalizedCronJobs } from '@/lib/shell'
import { isFailing } from '@/lib/cron'
import { PageHeader } from '@/components/shared/page-header'
import { CronJobList } from './cron-job-list'
import { Card, CardContent } from '@/components/ui/card'
import { Clock, Terminal, PlugZap } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CronPage() {
  const { reachable, jobs: cronJobs } = await getNormalizedCronJobs()
  const failedCount = cronJobs.filter(isFailing).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cron Jobs"
        description={
          !reachable
            ? "Can't reach openclaw — cron state unknown"
            : cronJobs.length === 0
              ? 'No scheduled tasks yet'
              : `${cronJobs.length} scheduled · ${failedCount} failing`
        }
        breadcrumbs={[
          { label: 'System', href: '/system' },
          { label: 'Cron Jobs' },
        ]}
      />
      {!reachable ? (
        <Card className="border-status-danger/30 bg-status-danger/5">
          <CardContent className="py-12">
            <div className="max-w-md mx-auto text-center space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-status-danger/10">
                <PlugZap className="h-6 w-6 text-status-danger" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Can&apos;t reach openclaw</h3>
                <p className="text-sm text-muted-foreground">
                  This is <strong>not</strong> the same as having no jobs — the dashboard could not run{' '}
                  <code className="font-mono text-xs">openclaw cron list</code>, so the state of every
                  scheduled task is unknown. Jobs may be running, failing, or stopped.
                </p>
              </div>
              <div className="rounded-md border border-border bg-card/50 p-4 text-left space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Terminal className="h-3.5 w-3.5" />
                  Check the CLI
                </div>
                <pre className="text-xs font-mono text-foreground overflow-x-auto">
                  <code>{`openclaw cron list --json
openclaw gateway start   # if the gateway is wedged`}</code>
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : cronJobs.length === 0 ? (
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
