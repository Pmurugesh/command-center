import { getBidDetail } from '@/lib/files'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/page-header'
import { BidDetailTabs } from './bid-detail-tabs'
import { BidStatusControls } from './bid-status-controls'
import { BidDocuments } from './bid-documents'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { AlertTriangle, FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function BidDetailPage({ params }: { params: { bidName: string } }) {
  const detail = await getBidDetail(params.bidName)
  if (!detail) notFound()

  // Collect all [HUMAN DECISION NEEDED] flags with file locations
  const flagLocations: { file: string; count: number }[] = detail.files
    .filter(f => f.flagCount > 0)
    .map(f => ({ file: f.displayName, count: f.flagCount }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.displayName}
        description={
          detail.documents && detail.documents.length > 0
            ? `${detail.files.length} analysis report${detail.files.length === 1 ? '' : 's'} · ${detail.documents.length} attached file${detail.documents.length === 1 ? '' : 's'}`
            : `${detail.files.length} analysis report${detail.files.length === 1 ? '' : 's'}`
        }
        breadcrumbs={[
          { label: 'Bids', href: '/bids' },
          { label: detail.displayName },
        ]}
        actions={
          <BidStatusControls bidName={detail.name} initialStatus={detail.status} initialEntity={detail.entity} />
        }
      />

      {/* Action Items Banner */}
      {detail.totalFlags > 0 && (
        <Card className="border-status-danger/30 bg-status-danger/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-status-danger">
              <AlertTriangle className="h-4 w-4" />
              {detail.totalFlags} Decision{detail.totalFlags > 1 ? 's' : ''} Needed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {flagLocations.map(loc => (
                <Badge key={loc.file} variant="destructive" className="text-xs font-mono tabular-nums">
                  {loc.file} · {loc.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document tabs */}
      <BidDetailTabs files={detail.files} />

      {/* Source documents */}
      {detail.documents && detail.documents.length > 0 && (
        <BidDocuments documents={detail.documents} />
      )}
    </div>
  )
}
