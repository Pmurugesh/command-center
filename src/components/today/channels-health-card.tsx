import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Landmark, ArrowRight } from 'lucide-react'
import type { Channel } from '@/lib/channels'

/**
 * Renders ONLY when a channel or vehicle is blocked or provably cold — the
 * SLP-goes-dark-for-11-months failure class. A calm channel portfolio means no
 * card at all (the morning-actions precedent: a permanently empty card teaches
 * the eye to skip cards).
 */
export function ChannelsHealthCard({ alerts }: { alerts: Channel[] }) {
  if (alerts.length === 0) return null

  return (
    <Card className="border-status-warning/30 bg-status-warning/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" />
            Channels going dark
            <Badge variant="outline" className="font-mono text-[10px] tabular-nums">{alerts.length}</Badge>
          </CardTitle>
          <Link href="/channels" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
            All channels <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {alerts.map(c => (
            <li key={c.slug} className="py-2.5 first:pt-0 last:pb-0">
              <Link href={`/channels#${c.slug}`} className="group flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium group-hover:text-blue-400">{c.name}</p>
                    {c.isVehicle && <Badge variant="outline" className="shrink-0 text-[10px]">vehicle</Badge>}
                    {c.status === 'blocked' && <Badge variant="destructive" className="shrink-0 text-[10px]">blocked</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.blockedOn ? `Blocked on ${c.blockedOn}` : c.nextActions[0] ?? 'no next action recorded'}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-status-warning">
                  {c.daysSinceTouch}d quiet
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
