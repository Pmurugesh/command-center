import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Partnership, PartnershipStatus } from '@/types'

const STATUS_DOT: Record<PartnershipStatus, string> = {
  'active':     'bg-status-success',
  'in-contact': 'bg-status-warning',
  'potential':  'bg-slate-500',
  'unknown':    'bg-slate-700',
}

const STATUS_LABEL: Record<PartnershipStatus, string> = {
  'active':     'Active',
  'in-contact': 'In Contact',
  'potential':  'Potential',
  'unknown':    'Unscored',
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface ActionQueueCardProps {
  items: Partnership[]
  href?: string  // anchor link target prefix for "Open partnership" jumps
}

export function ActionQueueCard({ items, href = '/partnerships' }: ActionQueueCardProps) {
  if (items.length === 0) return null

  return (
    <Card className="border-status-accent/30 bg-status-accent/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-status-accent" />
            Action queue
            <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{items.length}</Badge>
          </CardTitle>
          <Link href={href} className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
            Partnerships <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map(p => (
            <li key={p.name}>
              <Link
                href={`${href}#partnership-${slugify(p.name)}`}
                className="flex items-start gap-3 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-status-accent/10 transition-colors group"
              >
                <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0', STATUS_DOT[p.status])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">{STATUS_LABEL[p.status]}</span>
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    <ArrowRight className="h-3 w-3 inline mr-1 -mt-0.5" />
                    {p.nextAction}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
