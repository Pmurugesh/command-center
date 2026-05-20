import { cn } from '@/lib/utils'

type StatusType = 'ok' | 'success' | 'error' | 'failed' | 'warning' | 'running' | 'idle' | 'pending' | 'disabled'

const STATUS_CONFIG: Record<StatusType, { label: string; dotClass: string; bgClass: string }> = {
  ok: { label: 'OK', dotClass: 'bg-emerald-400', bgClass: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' },
  success: { label: 'Success', dotClass: 'bg-emerald-400', bgClass: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' },
  error: { label: 'Error', dotClass: 'bg-red-400', bgClass: 'bg-red-400/10 text-red-400 border-red-400/20' },
  failed: { label: 'Failed', dotClass: 'bg-red-400', bgClass: 'bg-red-400/10 text-red-400 border-red-400/20' },
  warning: { label: 'Warning', dotClass: 'bg-yellow-400', bgClass: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' },
  running: { label: 'Running', dotClass: 'bg-blue-400 animate-pulse', bgClass: 'bg-blue-400/10 text-blue-400 border-blue-400/20' },
  idle: { label: 'Idle', dotClass: 'bg-slate-400', bgClass: 'bg-slate-400/10 text-slate-400 border-slate-400/20' },
  pending: { label: 'Pending', dotClass: 'bg-slate-400', bgClass: 'bg-slate-400/10 text-slate-400 border-slate-400/20' },
  disabled: { label: 'Disabled', dotClass: 'bg-slate-600', bgClass: 'bg-slate-600/10 text-slate-500 border-slate-600/20' },
}

interface StatusBadgeProps {
  status: string
  label?: string
  showDot?: boolean
  className?: string
}

export function StatusBadge({ status, label, showDot = true, className }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase() as StatusType
  const config = STATUS_CONFIG[normalizedStatus] || STATUS_CONFIG.idle
  const displayLabel = label || config.label

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
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
    green: 'bg-emerald-400',
    yellow: 'bg-yellow-400',
    red: 'bg-red-400 animate-pulse',
  }
  return <span className={cn('h-2.5 w-2.5 rounded-full inline-block', colors[status])} />
}
