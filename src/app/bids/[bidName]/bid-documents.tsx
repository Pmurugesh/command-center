import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { FileText, File } from 'lucide-react'
import type { DocumentFile } from '@/types'
import type { IntakeReceipt } from '@/lib/intake'
import { isoToLocalDate } from '@/lib/dates'
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

/** One honest line from the newest upload receipt: triggered, started, or not started. */
function receiptLine(r: IntakeReceipt): { text: string; tone: string } {
  const when = isoToLocalDate(r.startedAt)
  if (r.ok === true) return { text: `Agent ${r.agent} started on the last upload (${when}).`, tone: 'text-emerald-400' }
  if (r.ok === false) return { text: `Agent ${r.agent} not started on the last upload (${when}): ${r.error ?? 'trigger failed'}.`, tone: 'text-red-400' }
  return { text: `Agent ${r.agent} triggered on the last upload (${when}) — no result recorded yet.`, tone: 'text-muted-foreground' }
}

export function BidDocuments({ documents, bidName, receipt }: {
  documents: DocumentFile[]; bidName: string; receipt?: IntakeReceipt | null
}) {
  const status = receipt ? receiptLine(receipt) : null
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
          {status && <p className={`mb-3 text-xs ${status.tone}`}>{status.text}</p>}
          <BidUpload bidName={bidName} />
        </div>
      </CardContent>
    </Card>
  )
}
