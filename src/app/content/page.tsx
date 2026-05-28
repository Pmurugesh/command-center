import { ComingSoon } from '@/components/shared/coming-soon'
import { PenTool } from 'lucide-react'

export default function ContentPage() {
  return (
    <ComingSoon
      title="Content"
      description="Marketing content, editorial calendar, and social-post drafts"
      icon={PenTool}
      willInclude={[
        'Editorial calendar with scheduled publish dates',
        'Drafts in progress — blog posts, newsletters, social',
        'Published archive with engagement metrics',
        'Tone guidelines and reusable content blocks',
      ]}
      dataSource="~/repos/operations/content/"
    />
  )
}
