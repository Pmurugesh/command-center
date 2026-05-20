import { listBids } from '@/lib/files'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import Link from 'next/link'
import { FileText, ArrowRight, FolderOpen } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function BidsPage() {
  const bids = await listBids()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bid Pipeline"
        description={`${bids.length} active bids and proposals`}
      />

      {bids.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No bids found"
          description="Add bid folders to ~/repos/operations/bids/ to see them here"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bids.map((bid) => (
            <Link key={bid.name} href={`/bids/${bid.name}`}>
              <Card className="hover:bg-accent/30 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">{bid.displayName}</CardTitle>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <CardDescription className="flex items-center gap-2">
                    {bid.name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {bid.status && <StatusBadge status={bid.status === 'Analyzing' ? 'running' : bid.status === 'Won' ? 'success' : bid.status === 'Lost' ? 'error' : 'idle'} label={bid.status} />}
                    {bid.entity && <Badge variant="outline" className="text-xs">{bid.entity}</Badge>}
                    <Badge variant="secondary">{bid.fileCount} documents</Badge>
                    {bid.hasDocuments && <Badge variant="outline" className="text-xs">Has source docs</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {bid.files.slice(0, 5).map((file) => (
                      <Badge key={file} variant="outline" className="text-xs text-muted-foreground">
                        {file}
                      </Badge>
                    ))}
                    {bid.files.length > 5 && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">+{bid.files.length - 5} more</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
