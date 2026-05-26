import { listAgencies } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { AgenciesBrowser } from './agencies-browser'
import { Building2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AgenciesPage() {
  const agencies = await listAgencies()
  const highCount = agencies.filter(a => a.priority === 'high').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agencies"
        description={
          agencies.length === 0
            ? 'Agency profiles will appear when added to ~/repos/operations/intelligence/agencies/'
            : `${agencies.length} agenc${agencies.length === 1 ? 'y' : 'ies'} · ${highCount} high priority`
        }
      />

      {agencies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No agencies found"
          description="Add agency .md files to ~/repos/operations/intelligence/agencies/ to see them here"
        />
      ) : (
        <AgenciesBrowser agencies={agencies} />
      )}
    </div>
  )
}
