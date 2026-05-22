import { cn } from '@/lib/utils'

type StatusKey =
  // System / operational states
  | 'ok' | 'success' | 'error' | 'failed' | 'warning' | 'running'
  | 'idle' | 'pending' | 'disabled'
  // Bid workflow stages
  | 'discovered' | 'analyzing' | 'draft ready' | 'under review'
  | 'submitted' | 'won' | 'lost' | 'no-bid'

interface BadgeConfig {
  label: string
  dotClass: string
  bgClass: string
}

const STATUS_CONFIG: Record<StatusKey, BadgeConfig> = {
  // System / operational
  ok:       { label: 'OK',       dotClass: 'bg-status-success',           bgClass: 'bg-status-success/10 text-status-success border-status-success/30' },
  success:  { label: 'Success',  dotClass: 'bg-status-success',           bgClass: 'bg-status-success/10 text-status-success border-status-success/30' },
  error:    { label: 'Error',    dotClass: 'bg-status-danger',            bgClass: 'bg-status-danger/10 text-status-danger border-status-danger/30' },
  failed:   { label: 'Failed',   dotClass: 'bg-status-danger',            bgClass: 'bg-status-danger/10 text-status-danger border-status-danger/30' },
  warning:  { label: 'Warning',  dotClass: 'bg-status-warning',           bgClass: 'bg-status-warning/10 text-status-warning border-status-warning/30' },
  running:  { label: 'Running',  dotClass: 'bg-status-accent animate-pulse', bgClass: 'bg-status-accent/10 text-status-accent border-status-accent/30' },
  idle:     { label: 'Idle',     dotClass: 'bg-slate-400',                bgClass: 'bg-slate-400/10 text-slate-400 border-slate-400/20' },
  pending:  { label: 'Pending',  dotClass: 'bg-slate-400',                bgClass: 'bg-slate-400/10 text-slate-400 border-slate-400/20' },
  disabled: { label: 'Disabled', dotClass: 'bg-slate-600',                bgClass: 'bg-slate-600/10 text-slate-500 border-slate-600/20' },
  // Bid workflow — each stage has its own color so the pipeline is visible at a glance
  'discovered':    { label: 'Discovered',    dotClass: 'bg-bid-discovered', bgClass: 'bg-bid-discovered/10 text-bid-discovered border-bid-discovered/30' },
  'analyzing':     { label: 'Analyzing',     dotClass: 'bg-bid-analyzing animate-pulse', bgClass: 'bg-bid-analyzing/10 text-bid-analyzing border-bid-analyzing/30' },
  'draft ready':   { label: 'Draft Ready',   dotClass: 'bg-bid-draft',      bgClass: 'bg-bid-draft/10 text-bid-draft border-bid-draft/30' },
  'under review':  { label: 'Under Review',  dotClass: 'bg-bid-review',     bgClass: 'bg-bid-review/10 text-bid-review border-bid-review/30' },
  'submitted':     { label: 'Submitted',     dotClass: 'bg-bid-submitted',  bgClass: 'bg-bid-submitted/10 text-bid-submitted border-bid-submitted/30' },
  'won':           { label: 'Won',           dotClass: 'bg-bid-won',        bgClass: 'bg-bid-won/10 text-bid-won border-bid-won/30' },
  'lost':          { label: 'Lost',          dotClass: 'bg-bid-lost',       bgClass: 'bg-bid-lost/10 text-bid-lost border-bid-lost/30' },
  'no-bid':        { label: 'No-Bid',        dotClass: 'bg-bid-nobid',      bgClass: 'bg-bid-nobid/10 text-bid-nobid border-bid-nobid/30' },
}

interface StatusBadgeProps {
  status: string
  label?: string
  showDot?: boolean
  className?: string
}

export function StatusBadge({ status, label, showDot = true, className }: StatusBadgeProps) {
  const key = status.toLowerCase() as StatusKey
  const config = STATUS_CONFIG[key] || STATUS_CONFIG.idle
  const displayLabel = label || config.label

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      config.bgClass,
      className
    )}>
      {showDot && <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />}
      {displayLabel}
    </span>
  )
}

// Simple dot-only indicator for the top bar
export function HealthDot({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const colors = {
    green: 'bg-status-success',
    yellow: 'bg-status-warning',
    red: 'bg-status-danger animate-pulse',
  }
  return <span className={cn('h-2.5 w-2.5 rounded-full inline-block', colors[status])} />
}
