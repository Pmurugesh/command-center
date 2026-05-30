import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ClipboardList, CheckCircle2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

export function MorningActionsCard({ content }: { content: string }) {
  if (!content) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Morning Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            No morning actions yet — scans will generate them overnight
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-blue-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Morning Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </CardContent>
    </Card>
  )
}
