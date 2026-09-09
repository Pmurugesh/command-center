import { getDataSources, listScripts } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { readDeployState } from '@/lib/deploy-state'
import { Database, Terminal, CreditCard, Mail, GitCommitHorizontal } from 'lucide-react'
import os from 'os'

export const dynamic = 'force-dynamic'

// Collapse /Users/<user> → ~ for readable paths; full path stays in title attr
function collapseHome(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

export default async function SystemPage() {
  const [dataSources, scripts, deploy] = await Promise.all([
    getDataSources(),
    listScripts(),
    readDeployState(),
  ])

  const okCount = dataSources.filter(s => s.exists).length
  const missingCount = dataSources.length - okCount

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Settings"
        description="Data sources, scripts, and configuration"
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{okCount}/{dataSources.length}</span>
            <span>sources connected</span>
          </div>
        }
      />

      {/* Which code is actually being served.
          The dashboard looks identical whether the mini is on origin/main or
          frozen weeks behind on an old bundle, because deploy-on-merge keeps the
          old build serving when a new one fails. This is the only place that
          difference is visible. Rendered only where the file exists — a dev
          machine is not a deploy target and should not claim to be one. */}
      {deploy && (
        <Card className={
          deploy.severity === 'danger' ? 'border-status-danger/40'
            : deploy.severity === 'warn' ? 'border-status-warning/40' : undefined
        }>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <GitCommitHorizontal className="h-5 w-5" />
              Deployed code
            </CardTitle>
            <CardDescription>
              What <span className="font-mono text-xs">{deploy.host ?? 'this host'}</span> is
              serving, recorded by <span className="font-mono text-xs">deploy-on-merge</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className={
              deploy.severity === 'danger' ? 'text-sm font-medium text-status-danger'
                : deploy.severity === 'warn' ? 'text-sm font-medium text-status-warning'
                : 'text-sm font-medium'
            }>
              {deploy.headline}
            </p>
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Serving</dt>
              <dd className="font-mono">
                {deploy.sha.slice(0, 7)}
                {deploy.subject ? <span className="ml-2 text-muted-foreground">{deploy.subject}</span> : null}
              </dd>
              {deploy.behind && (
                <>
                  <dt className="text-muted-foreground">origin/main</dt>
                  <dd className="font-mono text-status-warning">{deploy.target.slice(0, 7)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="font-mono tabular-nums">
                <TimeAgo date={deploy.at} />
              </dd>
            </dl>
            {/* Say the consequence, not just the state — "build failed" is a fact
                about the build; "you are reading old data" is what it costs. */}
            {deploy.severity === 'danger' && (
              <p className="text-xs leading-relaxed text-status-danger/90">
                Everything on this dashboard is rendered by the older commit. Merging a fix to
                main is what clears this — the mini retries every five minutes.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Sources
          </CardTitle>
          <CardDescription>
            {missingCount === 0 ? 'All directories the dashboard reads from' : `${missingCount} of ${dataSources.length} directories missing`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {dataSources.map((source) => (
              <div key={source.name} className="flex items-center justify-between rounded-md border border-border p-3 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate" title={source.path}>
                    {collapseHome(source.path)}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {source.exists ? (
                    <>
                      <span className="text-xs text-muted-foreground font-mono tabular-nums">
                        {source.fileCount} {source.fileCount === 1 ? 'item' : 'items'}
                      </span>
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
