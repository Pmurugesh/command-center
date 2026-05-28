import { ComingSoon } from '@/components/shared/coming-soon'
import { TrendingUp } from 'lucide-react'

export default function FundraisePage() {
  return (
    <ComingSoon
      title="Fundraise"
      description="Investor pipeline, conversations, and round tracking"
      icon={TrendingUp}
      willInclude={[
        'Investor pipeline by stage (intro, meeting, term sheet)',
        'Conversation log with next-action queue',
        'Pitch deck versions and feedback notes',
        'Round economics and dilution scenarios',
      ]}
      dataSource="~/repos/operations/fundraise/"
    />
  )
}
