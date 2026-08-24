import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMeeting } from '@/lib/meetings'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { ArrowLeft, Users } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MeetingDetailPage({ params }: { params: { slug: string } }) {
  const meeting = await getMeeting(params.slug)
  if (!meeting) notFound()

  const dateLabel = new Date(`${meeting.date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="space-y-6">
      <Link
        href="/meetings"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> All meetings
      </Link>

      <PageHeader
        title={meeting.title}
        description={dateLabel}
        actions={
          <div className="flex items-center gap-2">
            {meeting.agency && (
              <Badge variant="outline" className="text-[10px] uppercase">{meeting.agency}</Badge>
            )}
            <Badge variant="outline" className="text-[10px]">{meeting.category}</Badge>
          </div>
        }
      />

      {(meeting.contacts.length > 0 || meeting.participants.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {meeting.contacts.map(slug => (
            <Badge key={slug} variant="outline" className="text-[10px]">{slug}</Badge>
          ))}
          {meeting.participants.map(p => (
            <span key={p} className="font-mono">{p}</span>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <MarkdownRenderer content={meeting.content} linkifyContacts />
        </CardContent>
      </Card>

      {meeting.granolaId && (
        <p className="text-xs text-muted-foreground">
          Source: Granola · <code className="font-mono">{meeting.granolaId}</code>
        </p>
      )}
    </div>
  )
}
