import { ComingSoon } from '@/components/shared/coming-soon'
import { Bot } from 'lucide-react'

export default function AgentsPage() {
  return (
    <ComingSoon
      title="Agents"
      description="AI agent registry, recent runs, and configuration"
      icon={Bot}
      willInclude={[
        'Active agent definitions and prompts',
        'Recent run history with status and duration',
        'Token and cost usage by agent',
        'Cron-scheduled agent triggers',
      ]}
      dataSource="~/.claude/agents/"
    />
  )
}
