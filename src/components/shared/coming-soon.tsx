import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { LucideIcon } from 'lucide-react'

interface ComingSoonProps {
  title: string
  description: string
  icon: LucideIcon
  willInclude?: string[]      // bullet list of features that will live here
  dataSource?: string          // file/path the page will read from (file-driven dashboard convention)
}

/**
 * Placeholder page used while a section's real implementation is in flight.
 * Keeps the route navigable from the sidebar instead of 404'ing, and doubles
 * as a contract for what the page will eventually surface.
 */
export function ComingSoon({ title, description, icon: Icon, willInclude, dataSource }: ComingSoonProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={<Badge variant="outline" className="text-[10px] uppercase tracking-wide">Planned</Badge>}
      />

      <Card>
        <CardContent className="p-8 flex flex-col items-center text-center space-y-6">
          <Icon className="h-12 w-12 text-muted-foreground/40" />

          <div>
            <h3 className="text-lg font-medium">Not built yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              This section is reserved in the navigation. The page will fill in as the workflow takes shape.
            </p>
          </div>

          {willInclude && willInclude.length > 0 && (
            <div className="text-left max-w-md w-full">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                What will live here
              </p>
              <ul className="space-y-1.5 text-sm">
                {willInclude.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-muted-foreground/40 mt-0.5">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dataSource && (
            <div className="text-xs text-muted-foreground/70 pt-3 border-t border-border w-full max-w-md">
              Will read from{' '}
              <code className="font-mono tabular-nums text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">
                {dataSource}
              </code>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
