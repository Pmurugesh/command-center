import { PageHeader } from '@/components/shared/page-header'
import { IntakeForm } from './intake-form'

export const dynamic = 'force-dynamic'

export default function IntakePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Intake"
        description="Drop files from any device — they land next to the data on the mini"
      />
      <IntakeForm />
    </div>
  )
}
