import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { DecisionItem } from '@/lib/decisions'

interface DecisionsCardProps {
  decisions: DecisionItem[]
  limit?: number  // initial number to show; "show more" expands via <details>
}

export function DecisionsCard({ decisions, limit = 5 }: DecisionsCardProps) {
  if (decisions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Decisions waiting on you
            <Badge variant="outline" className="text-[10px] font-mono tabular-nums">0</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No pending decisions across active bids. You&apos;re clear.</p>
        </CardContent>
      </Card>
    )
  }

  const visible = decisions.slice(0, limit)
  const overflow = decisions.slice(limit)

  return (
    <Card className="border-status-warning/30 bg-status-warning/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-warning" />
            Decisions waiting on you
            <Badge variant="warning" className="text-[10px] font-mono tabular-nums">{decisions.length}</Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map(d => <DecisionRow key={`${d.bidName}/${d.fileName}/${d.flagIndex}`} item={d} />)}

        {overflow.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors select-none pl-1 pt-2">
              Show {overflow.length} more
            </summary>
            <div className="space-y-2 pt-2">
              {overflow.map(d => <DecisionRow key={`${d.bidName}/${d.fileName}/${d.flagIndex}`} item={d} />)}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function DecisionRow({ item }: { item: DecisionItem }) {
  // Snippet — strip the [HUMAN DECISION NEEDED] marker (it's the title chip) and
  // trim to a readable preview.
  const preview = item.snippet
    .replace(/\[HUMAN DECISION NEEDED\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)

  return (
    <Link
      href={`/bids/${item.bidName}#${item.fileName}`}
      className="block group rounded-md border border-status-warning/20 p-3 hover:border-status-warning/50 hover:bg-status-warning/10 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-foreground truncate">{item.bidDisplayName}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">{item.fileDisplayName}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-mono tabular-nums text-muted-foreground/70">line {item.lineNumber}</span>
          </div>
          {preview && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-snug">{preview}{preview.length >= 220 ? '…' : ''}</p>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-status-warning transition-colors flex-shrink-0 mt-0.5" />
      </div>
    </Link>
  )
}
