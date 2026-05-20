import { getCronJobs } from '@/lib/shell'
import { PageHeader } from '@/components/shared/page-header'
import { CronJobList } from './cron-job-list'
import type { CronJob } from '@/types'

export const dynamic = 'force-dynamic'

export default async function CronPage() {
  const cronJobs = await getCronJobs() as CronJob[]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cron Jobs"
        description={`${cronJobs.length} scheduled tasks`}
        breadcrumbs={[
          { label: 'System', href: '/system' },
          { label: 'Cron Jobs' },
        ]}
      />
      <CronJobList jobs={cronJobs} />
    </div>
  )
}
