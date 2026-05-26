import { getAgency } from '@/lib/files'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { TimeAgo } from '@/components/shared/time-ago'
import { Mail, Users } from 'lucide-react'
import { AgencyActions } from './agency-actions'
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
  const emails = agency.contacts.map(c => c.email)

  return (
    <div className="space-y-6">
      <PageHeader
        title={agency.displayName}
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

      {/* Meta strip: file + last-modified + bulk actions */}
      <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="font-mono tabular-nums">{agency.filename}</span>
          <span className="opacity-50">·</span>
          <span>Updated <TimeAgo date={agency.lastModified} /></span>
        </div>
        <AgencyActions emails={emails} />
      </div>

      {/* 2-column body: contact panel left, content right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                Contacts
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {agency.contacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No email addresses found in the file.</p>
              ) : (
                <ul className="space-y-2.5">
                  {agency.contacts.map((c, idx) => (
                    <li key={`${c.email}-${idx}`} className="text-sm">
                      {c.name && <div className="text-foreground leading-tight">{c.name}</div>}
                      <a
                        href={`mailto:${c.email}`}
                        className="text-blue-400 hover:underline font-mono text-xs tabular-nums break-all"
                      >
                        {c.email}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-3">
          <CardContent className="p-6">
            <div className="max-w-3xl">
              <MarkdownRenderer content={agency.content} linkifyContacts />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
