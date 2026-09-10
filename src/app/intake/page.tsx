import { PageHeader } from '@/components/shared/page-header'
import { IntakeForm } from './intake-form'
import { ReviewQueue } from './review-queue'

export const dynamic = 'force-dynamic'

export default function IntakePage() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="Intake"
        description="Drop files from any device — they land next to the data on the mini"
      />
      {/* The queue is the work; the form is an occasional action that was
          rendered at full width below it. Side by side, the form stops pushing
          the queue off the fold and stops stretching ~500px of controls across
          1,489px. See tasks/todo.md Phase 14. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <ReviewQueue />
        <div className="xl:sticky xl:top-0 xl:self-start">
          <IntakeForm />
        </div>
      </div>
    </div>
  )
}
