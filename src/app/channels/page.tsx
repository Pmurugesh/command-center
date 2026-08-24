/**
 * Channels & vehicles — contract vehicles, resellers, alliances, SIs.
 *
 * The durable moat, with clocks. Vehicles group first (they outlive any deal),
 * then partners by how much attention each needs. Absorbs /partnerships, which
 * redirects here. Every record is a frontmattered file in operations
 * intelligence/partnerships/ — auto-discovered, no manual wiring.
 */
import { listChannels, CHANNEL_WARN_DAYS, CHANNEL_COLD_DAYS, type Channel } from '@/lib/channels'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Landmark, Handshake } from 'lucide-react'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function StalenessPill({ channel }: { channel: Channel }) {
  if (channel.daysSinceTouch === null) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">
        no touch date
      </span>
    )
  }
  const tone =
    channel.staleness === 'cold' ? 'bg-status-danger/10 text-status-danger border-status-danger/30' :
    channel.staleness === 'warn' ? 'bg-status-warning/10 text-status-warning border-status-warning/30' :
    'bg-muted text-muted-foreground border-border'
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-xs font-medium tabular-nums', tone)}>
      {channel.daysSinceTouch}d
    </span>
  )
}

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = {
  'active': 'success',
  'blocked': 'destructive',
  'dormant': 'warning',
  'in-contact': 'warning',
  'potential': 'secondary',
}

function ChannelCard({ channel }: { channel: Channel }) {
  const alerting = channel.status === 'blocked' || channel.staleness === 'cold'
  return (
    <Card
      id={channel.slug}
      className={cn('scroll-mt-16', alerting && 'border-status-warning/30')}
    >
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{channel.name}</h3>
          <Badge variant={STATUS_BADGE[channel.status] ?? 'outline'} className="text-[10px]">
            {channel.status}
          </Badge>
          <Badge variant="outline" className="text-[10px]">{channel.type}</Badge>
          {channel.entity && <Badge variant="outline" className="text-[10px]">{channel.entity}</Badge>}
          <div className="ml-auto flex items-center gap-2">
            {channel.owner && <span className="text-xs text-muted-foreground">{channel.owner}</span>}
            <StalenessPill channel={channel} />
          </div>
        </div>

        {channel.blockedOn && (
          <p className="mt-2 text-sm text-status-danger">Blocked on: {channel.blockedOn}</p>
        )}

        {channel.nextActions.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground">Next actions</p>
            <ul className="mt-1 space-y-1">
              {channel.nextActions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-accent" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer select-none py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            Details
          </summary>
          <div className="mt-2 border-t border-border pt-3">
            <MarkdownRenderer content={channel.body} />
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

export default async function ChannelsPage() {
  const channels = await listChannels()
  const vehicles = channels.filter(c => c.isVehicle)
  const partners = channels.filter(c => !c.isVehicle)
  const alerting = channels.filter(c => c.status === 'blocked' || c.staleness === 'cold').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Channels"
        description={
          channels.length === 0
            ? 'Vehicles, resellers, and alliances will appear when added to ~/repos/operations/intelligence/partnerships/'
            : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} · ${partners.length} partner${partners.length === 1 ? '' : 's'}` +
              (alerting > 0 ? ` · ${alerting} need attention` : '') +
              ` — clocks: ${CHANNEL_WARN_DAYS}d warn / ${CHANNEL_COLD_DAYS}d cold`
        }
      />

      {channels.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No channels found"
          description="Add frontmattered .md files to ~/repos/operations/intelligence/partnerships/ to see them here"
        />
      ) : (
        <>
          {vehicles.length > 0 && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Landmark className="h-4 w-4" /> Contract vehicles
              </h2>
              {vehicles.map(c => <ChannelCard key={c.slug} channel={c} />)}
            </section>
          )}
          {partners.length > 0 && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Handshake className="h-4 w-4" /> Partners
              </h2>
              {partners.map(c => <ChannelCard key={c.slug} channel={c} />)}
            </section>
          )}
        </>
      )}
    </div>
  )
}
