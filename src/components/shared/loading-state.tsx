import { cn } from '@/lib/utils'

export function LoadingState({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="h-8 w-48 bg-muted animate-pulse rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-muted animate-pulse rounded-lg" />
    </div>
  )
}

export function LoadingCard() {
  return <div className="h-32 bg-muted animate-pulse rounded-lg" />
}

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-muted animate-pulse rounded"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  )
}
