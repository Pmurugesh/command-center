import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ClipboardList } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

export function MorningActionsCard({ content }: { content: string }) {
  // Nothing generates morning-actions.md yet — showing a permanent empty card
  // just teaches the eye to skip cards. Appear only when there's content.
  if (!content) return null

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
