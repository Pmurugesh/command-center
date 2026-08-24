import { cn } from '@/lib/utils'

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

/**
 * Three-tier deadline pill: ≤7d danger, ≤14d warning, else muted. Lifted from
 * the old opportunities card so the Clock and Channels read deadlines the same
 * way everywhere.
 */
export function DeadlineBadge({ deadlineAt }: { deadlineAt?: string }) {
  if (!deadlineAt) {
    return <span className="text-xs text-muted-foreground">no deadline listed</span>
  }
  const days = daysUntil(deadlineAt)
  const label = new Date(deadlineAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap font-mono tabular-nums',
      days <= 7  ? 'bg-status-danger/10 text-status-danger border-status-danger/30' :
      days <= 14 ? 'bg-status-warning/10 text-status-warning border-status-warning/30' :
                   'bg-muted text-muted-foreground border-border'
    )}>
      {label} · {days}d
    </span>
  )
}
