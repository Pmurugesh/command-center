import { getDataSources, listScripts } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { Database, Terminal, CreditCard, Mail } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function SystemPage() {
  const [dataSources, scripts] = await Promise.all([
    getDataSources(),
    listScripts(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Settings"
        description="Data sources, scripts, and configuration"
      />

      {/* Quick Links */}
      <div className="flex gap-3">
        <Link href="/system/cron" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/50 transition-colors">
          Manage Cron Jobs
        </Link>
      </div>

      {/* Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Sources
          </CardTitle>
          <CardDescription>All directories the dashboard reads from</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {dataSources.map((source) => (
              <div key={source.name} className="flex items-center justify-between rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{source.path}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {source.exists ? (
                    <>
                      <Badge variant="secondary">{source.fileCount} items</Badge>
                      {source.lastModified && (
                        <span className="text-xs text-muted-foreground">
                          <TimeAgo date={source.lastModified} />
                        </span>
                      )}
                      <StatusBadge status="ok" />
                    </>
                  ) : (
                    <StatusBadge status="error" label="Missing" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Scripts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Scripts
          </CardTitle>
          <CardDescription>Available automation scripts</CardDescription>
        </CardHeader>
        <CardContent>
          {scripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scripts found</p>
          ) : (
            <div className="space-y-3">
              {scripts.map((script) => (
                <div key={script.name} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium font-mono">{script.name}</p>
                    {script.description && (
                      <p className="text-xs text-muted-foreground">{script.description}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {(script.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Finance
            </CardTitle>
            <CardDescription>Coming soon — Invoice tracking and payment status</CardDescription>
          </CardHeader>
        </Card>
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Integration
            </CardTitle>
            <CardDescription>Coming soon — Email templates and tracking</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
