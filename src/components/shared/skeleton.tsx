import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />
}

export function SkeletonPage({
  variant = 'cards',
}: {
  variant?: 'cards' | 'list' | 'reader' | 'tabs'
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page header */}
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      {variant === 'cards' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-6 bg-card space-y-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-16" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-6 bg-card space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-3/4" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {variant === 'list' && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4 bg-card flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {variant === 'tabs' && (
        <>
          <div className="flex gap-2 border-b border-border pb-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
          <div className="rounded-lg border border-border p-6 bg-card space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className={cn('h-4', i % 3 === 0 ? 'w-5/6' : i % 3 === 1 ? 'w-3/4' : 'w-2/3')} />
            ))}
          </div>
        </>
      )}

      {variant === 'reader' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 rounded-lg border border-border p-3 bg-card space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
          <div className="lg:col-span-3 rounded-lg border border-border p-6 bg-card space-y-3">
            <Skeleton className="h-6 w-1/2" />
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className={cn('h-4', i % 3 === 0 ? 'w-5/6' : i % 3 === 1 ? 'w-3/4' : 'w-2/3')} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
