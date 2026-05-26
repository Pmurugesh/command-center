import { getPartnerships } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Handshake, Mail } from 'lucide-react'
import type { PartnershipStatus } from '@/types'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<PartnershipStatus, { variant: 'success' | 'warning' | 'secondary' | 'outline'; label: string }> = {
  'active':     { variant: 'success',   label: 'Active' },
  'in-contact': { variant: 'warning',   label: 'In Contact' },
  'potential':  { variant: 'secondary', label: 'Potential' },
  'unknown':    { variant: 'outline',   label: 'Unknown' },
}

export default async function PartnershipsPage() {
  const partnerships = await getPartnerships()

  const counts = {
    active: partnerships.filter(p => p.status === 'active').length,
    inContact: partnerships.filter(p => p.status === 'in-contact').length,
    potential: partnerships.filter(p => p.status === 'potential').length,
  }

  const description = partnerships.length === 0
    ? 'Partnership tracker will appear when ~/repos/operations/intelligence/partnerships/tracker.md exists'
    : `${counts.active} active · ${counts.inContact} in contact · ${counts.potential} potential`

  return (
    <div className="space-y-6">
      <PageHeader title="Partnerships" description={description} />

      {partnerships.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No partnerships found"
          description="Add ~/repos/operations/intelligence/partnerships/tracker.md with H2 sections per partnership"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {partnerships.map((p) => {
            const badge = STATUS_BADGE[p.status]
            return (
              <Card key={p.name} className="h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base leading-tight">{p.name}</CardTitle>
                    <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide flex-shrink-0">
                      {badge.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {p.contacts.length > 0 && (
                    <div className="space-y-1.5">
                      {p.contacts.map((c) => (
                        <div key={c.email} className="flex items-center gap-2 text-sm">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          {c.name && <span className="text-foreground">{c.name}</span>}
                          <a
                            href={`mailto:${c.email}`}
                            className="text-blue-400 hover:underline font-mono text-xs tabular-nums truncate"
                          >
                            {c.email}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.content && (
                    <div className="text-sm text-muted-foreground">
                      <MarkdownRenderer content={p.content} linkifyContacts />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
