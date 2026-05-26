import { getAgency } from '@/lib/files'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Users } from 'lucide-react'
import type { AgencyPriority } from '@/types'

export const dynamic = 'force-dynamic'

const PRIORITY_BADGE: Record<AgencyPriority, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  high: { variant: 'success', label: 'High priority' },
  medium: { variant: 'warning', label: 'Medium priority' },
  low: { variant: 'secondary', label: 'Low priority' },
}

export default async function AgencyDetailPage({ params }: { params: { slug: string } }) {
  const agency = await getAgency(decodeURIComponent(params.slug))
  if (!agency) notFound()

  const badge = PRIORITY_BADGE[agency.priority]

  return (
    <div className="space-y-6">
      <PageHeader
        title={agency.displayName}
        description={agency.filename}
        breadcrumbs={[
          { label: 'Agencies', href: '/agencies' },
          { label: agency.displayName },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide">
              {badge.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span className="font-mono tabular-nums">{agency.contactCount}</span>
              contact{agency.contactCount === 1 ? '' : 's'}
            </Badge>
          </div>
        }
      />

      <Card>
        <CardContent className="p-6">
          <div className="max-w-3xl">
            <MarkdownRenderer content={agency.content} linkifyContacts />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
