/**
 * GTM strategy docs, rendered. Not in the nav — this page exists as the deep-
 * link target for strategic decisions on Today (each Move links to
 * /gtm#<file>), and for reading the current plan without opening an editor.
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from '@/lib/paths'
import { extractFirstHeading, countFlags } from '@/lib/markdown'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { GtmReader, type GtmDoc } from './gtm-reader'
import { Compass } from 'lucide-react'

export const dynamic = 'force-dynamic'

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
          const date = slug.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
          // The index says which doc needs the founder. countFlags already
          // backs getStrategicDecisions over these same files.
          return { slug, title: extractFirstHeading(content) || slug, content, date, openDecisions: countFlags(content) }
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

  const openTotal = docs.reduce((n, d) => n + d.openDecisions, 0)

  return (
    <div className="space-y-3">
      <PageHeader
        title="GTM"
        description={`${docs.length} doc${docs.length === 1 ? '' : 's'}${openTotal > 0 ? ` · ${openTotal} open decisions` : ''}`}
      />
      {docs.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No GTM docs found"
          description="Add markdown files to ~/repos/operations/gtm/ to see them here"
        />
      ) : (
        <GtmReader docs={docs} />
      )}
    </div>
  )
}
