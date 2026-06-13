import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { FileText, File } from 'lucide-react'
import type { DocumentFile } from '@/types'
import { BidUpload } from './bid-upload'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const typeIcons: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
  xlsx: 'XLSX',
  xls: 'XLS',
  pptx: 'PPTX',
  txt: 'TXT',
}

export function BidDocuments({ documents, bidName }: { documents: DocumentFile[]; bidName: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Source Documents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground">No source documents yet.</p>
        )}
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.name}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-3">
                <File className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(doc.size)}</p>
                </div>
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase px-2 py-0.5 rounded bg-muted">
                {typeIcons[doc.type] || doc.type.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <BidUpload bidName={bidName} />
        </div>
      </CardContent>
    </Card>
  )
}
