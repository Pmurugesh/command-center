import { listLibraryFiles } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { LibraryBrowser } from './library-browser'
import { Library } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function LibraryPage() {
  const files = await listLibraryFiles()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Response Library"
        description="Company profiles, capability blocks, methodology templates, and style guide"
      />

      {files.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No library files found"
          description="Add files to ~/repos/operations/bids/_response-library/ to see them here"
        />
      ) : (
        <LibraryBrowser files={files} />
      )}
    </div>
  )
}
