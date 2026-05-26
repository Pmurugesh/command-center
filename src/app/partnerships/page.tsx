import { getPartnerships } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { ArrowRight, Handshake, Mail, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Partnership, PartnershipStatus } from '@/types'

export const dynamic = 'force-dynamic'

const STATUS_META: Record<PartnershipStatus, {
  label: string
  dotClass: string
  columnTint: string
  badge: 'success' | 'warning' | 'secondary' | 'outline'
}> = {
  'active':     { label: 'Active',     dotClass: 'bg-status-success',           columnTint: 'border-status-success/30', badge: 'success' },
  'in-contact': { label: 'In Contact', dotClass: 'bg-status-warning',           columnTint: 'border-status-warning/30', badge: 'warning' },
  'potential':  { label: 'Potential',  dotClass: 'bg-slate-500',                columnTint: 'border-slate-500/30',      badge: 'secondary' },
  'unknown':    { label: 'Unscored',   dotClass: 'bg-slate-700',                columnTint: 'border-slate-700/30',      badge: 'outline' },
}

const COLUMN_ORDER: PartnershipStatus[] = ['active', 'in-contact', 'potential', 'unknown']

export default async function PartnershipsPage() {
  const partnerships = await getPartnerships()

  if (partnerships.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Partnerships"
          description="Partnership tracker will appear when ~/repos/operations/intelligence/partnerships/tracker.md exists"
        />
        <EmptyState
          icon={Handshake}
          title="No partnerships found"
          description="Add ~/repos/operations/intelligence/partnerships/tracker.md with H2 sections per partnership"
        />
      </div>
    )
  }

  // Group by status
  const grouped = COLUMN_ORDER.map(status => ({
    status,
    items: partnerships.filter(p => p.status === status),
  }))

  // Visible columns: always show active/in-contact/potential; only show unknown if any exist
  const visibleColumns = grouped.filter(g => g.status !== 'unknown' || g.items.length > 0)

  // Action queue: every partnership with an unresolved next action
  const actionQueue = partnerships.filter(p => p.nextAction)

  const counts = {
    active: grouped[0].items.length,
    inContact: grouped[1].items.length,
    potential: grouped[2].items.length,
    unscored: grouped[3].items.length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partnerships"
        description={
          `${partnerships.length} total · ${counts.active} active · ${counts.inContact} in contact · ${counts.potential} potential` +
          (counts.unscored > 0 ? ` · ${counts.unscored} unscored` : '')
        }
      />

      {/* Action queue */}
      {actionQueue.length > 0 && (
        <Card className="border-status-accent/30 bg-status-accent/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-4 w-4 text-status-accent" />
              <h2 className="text-sm font-semibold">Action queue</h2>
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{actionQueue.length}</Badge>
            </div>
            <ul className="space-y-2">
              {actionQueue.map(p => {
                const meta = STATUS_META[p.status]
                return (
                  <li key={p.name} className="flex items-start gap-3 text-sm">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0", meta.dotClass)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">{meta.label}</span>
                      </div>
                      <div className="text-muted-foreground text-xs mt-0.5">
                        <ArrowRight className="h-3 w-3 inline mr-1 -mt-0.5" />
                        {p.nextAction}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Kanban columns */}
      <div className={cn(
        "grid gap-4",
        visibleColumns.length === 4
          ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
          : "grid-cols-1 md:grid-cols-3"
      )}>
        {visibleColumns.map(({ status, items }) => (
          <KanbanColumn key={status} status={status} items={items} />
        ))}
      </div>
    </div>
  )
}

function KanbanColumn({ status, items }: { status: PartnershipStatus; items: Partnership[] }) {
  const meta = STATUS_META[status]
  return (
    <div className="space-y-2">
      <div className={cn("flex items-center gap-2 px-2 py-1.5 rounded-md border-b-2", meta.columnTint)}>
        <span className={cn("h-2 w-2 rounded-full", meta.dotClass)} />
        <h3 className="text-xs font-semibold uppercase tracking-wider">{meta.label}</h3>
        <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-3">None</p>
      ) : (
        <div className="space-y-2">
          {items.map(p => <PartnershipCard key={p.name} partnership={p} />)}
        </div>
      )}
    </div>
  )
}

function PartnershipCard({ partnership: p }: { partnership: Partnership }) {
  const primaryContact = p.contacts[0]
  const additionalContacts = p.contacts.length - 1
  const meta = STATUS_META[p.status]

  // Strip status/next-action/contact lines from the rendered body to avoid duplication.
  const body = stripParsedLines(p.content)

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <h4 className="font-medium text-sm leading-tight flex-1">{p.name}</h4>
        </div>

        {p.nextAction && (
          <div className={cn("flex items-start gap-1.5 text-xs rounded-md p-2", "bg-status-accent/5 border border-status-accent/20")}>
            <Zap className="h-3 w-3 text-status-accent mt-0.5 flex-shrink-0" />
            <span className="text-foreground">{p.nextAction}</span>
          </div>
        )}

        {primaryContact && (
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-1.5 text-xs">
              <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              {primaryContact.name && <span className="text-foreground truncate">{primaryContact.name}</span>}
            </div>
            <a
              href={`mailto:${primaryContact.email}`}
              className="text-blue-400 hover:underline font-mono text-[11px] tabular-nums truncate block pl-4"
            >
              {primaryContact.email}
            </a>
            {additionalContacts > 0 && (
              <p className="text-[11px] text-muted-foreground pl-4">+{additionalContacts} more</p>
            )}
          </div>
        )}

        {body && (
          <details className="text-xs pt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors select-none">
              Details
            </summary>
            <div className="pt-2 text-muted-foreground">
              <MarkdownRenderer content={body} linkifyContacts />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

// Drop lines that the card surfaces in dedicated UI (status, contact emails, next action)
// so the collapsible "Details" body shows only the remaining narrative.
function stripParsedLines(content: string): string {
  return content
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (!t) return true
      if (/^\s*(?:[-*+]\s+)?\**\s*status\s*\**\s*[:\-]/i.test(line)) return false
      if (/^\s*(?:[-*+]\s+)?\**\s*(?:next(?:\s+steps?)?|action(?:\s+item)?|follow[\s-]?up)\s*\**\s*[:\-]/i.test(line)) return false
      // Drop lines that are *just* an email or "Name — email"
      const emailOnly = /^[\s\-*+•]*[A-Za-z0-9 .,'&()]*[<(]?[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+[>)]?\s*$/
      if (emailOnly.test(line)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
