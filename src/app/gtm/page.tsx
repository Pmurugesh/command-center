/**
 * GTM strategy docs, rendered. Not in the nav — this page exists as the deep-
 * link target for strategic decisions on Today (each Move links to
 * /gtm#<file>), and for reading the current plan without opening an editor.
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from '@/lib/paths'
import { extractFirstHeading } from '@/lib/markdown'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Compass } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface GtmDoc {
  slug: string // filename without .md — the anchor strategic moves point at
  title: string
  content: string
}

async function listGtmDocs(): Promise<GtmDoc[]> {
  let names: string[]
  try {
    names = await fs.readdir(PATHS.gtm)
  } catch {
    return []
  }
  const docs = await Promise.all(
    names
      .filter(n => n.endsWith('.md') && !n.startsWith('.'))
      .map(async (n): Promise<GtmDoc | null> => {
        try {
          const content = await fs.readFile(path.join(PATHS.gtm, n), 'utf-8')
          const slug = n.replace(/\.md$/, '')
          return { slug, title: extractFirstHeading(content) || slug, content }
        } catch {
          return null
        }
      })
  )
  // Newest dated docs first; undated reference docs (targets, lead-rules) sink
  // to the bottom. Plain desc-lexicographic would float letters above digits.
  const dated = (s: string) => /^\d/.test(s)
  return docs
    .filter((d): d is GtmDoc => d !== null)
    .sort((a, b) =>
      Number(dated(b.slug)) - Number(dated(a.slug)) || b.slug.localeCompare(a.slug)
    )
}

export default async function GtmPage() {
  const docs = await listGtmDocs()

  return (
    <div className="space-y-6">
      <PageHeader
        title="GTM"
        description={`Strategy docs from ~/repos/operations/gtm — ${docs.length} file${docs.length === 1 ? '' : 's'}`}
      />
      {docs.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No GTM docs found"
          description="Add markdown files to ~/repos/operations/gtm/ to see them here"
        />
      ) : (
        docs.map((doc, i) => (
          // scroll-mt keeps the anchored card clear of the sticky-ish top bar
          <Card key={doc.slug} id={doc.slug} className="scroll-mt-16">
            <CardContent className="p-6">
              <details open={i === 0}>
                <summary className="cursor-pointer select-none text-base font-semibold transition-colors hover:text-blue-400">
                  {doc.title}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{doc.slug}.md</span>
                </summary>
                <div className="mt-4 border-t border-border pt-4">
                  <MarkdownRenderer content={doc.content} />
                </div>
              </details>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
