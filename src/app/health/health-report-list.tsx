"use client"

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { TimeAgo } from '@/components/shared/time-ago'
import { ChevronDown, ChevronRight, Shield } from 'lucide-react'
import type { ScanReportWithDeltas } from '@/types'

export function HealthReportList({ reports }: { reports: ScanReportWithDeltas[] }) {
  const [expanded, setExpanded] = useState<string | null>(reports[0]?.name || null)

  return (
    <div className="space-y-4">
      {reports.map((report) => (
        <Card key={report.name}>
          <CardHeader
            className="cursor-pointer"
            onClick={() => setExpanded(expanded === report.name ? null : report.name)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {expanded === report.name ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    {report.displayName}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    Updated <TimeAgo date={report.lastModified} />
                    <span className="text-xs">({(report.size / 1024).toFixed(1)} KB)</span>
                  </CardDescription>
                </div>
              </div>
              <div className="flex gap-2">
                {report.criticalCount > 0 && (
                  <Badge variant="destructive">{report.criticalCount} critical</Badge>
                )}
                {report.deltas.new > 0 && (
                  <Badge variant="destructive">+{report.deltas.new} new</Badge>
                )}
                {report.deltas.resolved > 0 && (
                  <Badge variant="success">-{report.deltas.resolved} resolved</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          {expanded === report.name && (
            <CardContent>
              <div className="rounded-lg border border-border p-4 bg-background max-h-[600px] overflow-y-auto">
                <MarkdownRenderer content={report.content} />
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
