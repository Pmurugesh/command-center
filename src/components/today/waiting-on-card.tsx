import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users } from 'lucide-react'
import type { WaitingOnGroup } from '@/lib/moves'

/**
 * Delegation, made visible. Work owned by Ganapathy / Rani / Isaiah (and the
 * agents) with a live next action — grouped per owner so the question "what
 * did I hand off and is it stuck?" is one glance. A solo founder's alternative
 * is that everything not on this card silently defaults back to him.
 */
export function WaitingOnCard({ groups }: { groups: WaitingOnGroup[] }) {
  if (groups.length === 0) return null

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const overdue = groups.reduce((n, g) => n + g.overdueCount, 0)

  return (
    <Card className={overdue > 0 ? 'border-status-warning/30' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Waiting on
          <Badge variant="outline" className="font-mono text-[10px] tabular-nums">{total}</Badge>
          {overdue > 0 && (
            <Badge variant="warning" className="text-[10px]">{overdue} overdue</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {groups.map(g => (
          <div key={g.owner}>
            <p className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {g.owner}
              <span className="font-mono tabular-nums">{g.items.length}</span>
              {g.overdueCount > 0 && (
                <span className="font-mono tabular-nums text-status-warning">{g.overdueCount} overdue</span>
              )}
            </p>
            <ul className="divide-y divide-border">
              {g.items.map(item => (
                <li key={`${g.owner}:${item.slug}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.name}
                      {item.agencyName && <span className="text-muted-foreground"> · {item.agencyName}</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.nextAction}</p>
                  </div>
                  {item.daysOverdue !== undefined ? (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-status-warning">
                      {item.daysOverdue}d overdue
                    </span>
                  ) : item.nextActionDue ? (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      due {item.nextActionDue}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
