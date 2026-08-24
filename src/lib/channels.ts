/**
 * Channels & vehicles — the durable moat, with a staleness clock.
 *
 * Reads every frontmattered file in intelligence/partnerships/ (partners AND
 * contract vehicles share one shape, distinguished by `type`). The failure this
 * fixes: the SLP application sat dormant for 11 months and CAPSMA vanished into
 * Slack, because nothing anywhere had a clock on channel state. Same pattern as
 * CRM_COLD_DAYS for contacts, applied to the assets that outlive any one deal.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'

// A channel untouched for two months deserves a look; four months is cold.
// Slower clocks than contacts (21d): vehicles move at procurement speed.
export const CHANNEL_WARN_DAYS = 60
export const CHANNEL_COLD_DAYS = 120

export type ChannelStaleness = 'fresh' | 'warn' | 'cold' | 'unknown'

export interface Channel {
  slug: string
  name: string
  type: string // 'vehicle' | 'channel' | 'si' | 'technology' | …
  isVehicle: boolean
  status: string // 'active' | 'blocked' | 'dormant' | 'in-contact' | 'potential' | raw
  entity?: string
  owner?: string
  blockedOn?: string
  nextActions: string[] // bullets under "## Next Actions"
  lastTouchedAt: string | null // ISO
  daysSinceTouch: number | null
  staleness: ChannelStaleness
  body: string // full markdown body for the /channels page
}

function toIso(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString()
  if (typeof v === 'string') {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

function extractNextActions(body: string): string[] {
  const m = body.match(/^##\s+Next Actions\s*$([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/m)
  if (!m) return []
  return m[1]
    .split('\n')
    .map(l => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((s): s is string => Boolean(s))
}

/**
 * When was this channel last touched? Precedence: an explicit `last_touched`
 * frontmatter date (a human attesting to reality — the SLP seed carries
 * 2025-09-19, the day the trail went quiet) beats git history (which would read
 * as "fresh" the day the record is created) beats file mtime. If everything
 * fails the answer is 'unknown', which must neither cry cold nor read as fresh.
 */
async function lastTouched(absPath: string, frontmatter: Record<string, unknown>): Promise<string | null> {
  const attested = toIso(frontmatter.last_touched)
  if (attested) return attested

  try {
    const rel = path.relative(PATHS.operationsRoot, absPath)
    const out = await runCommandArgs(
      'git', ['-C', PATHS.operationsRoot, 'log', '-1', '--format=%aI', '--', rel], 15_000
    )
    const iso = toIso(out.trim())
    if (iso) return iso
  } catch { /* not a repo here, or git unavailable — fall through */ }

  try {
    return new Date((await fs.stat(absPath)).mtimeMs).toISOString()
  } catch {
    return null
  }
}

export async function listChannels(): Promise<Channel[]> {
  let names: string[]
  try {
    names = await fs.readdir(PATHS.partnerships)
  } catch {
    return []
  }

  const files = names.filter(n =>
    n.endsWith('.md') && n !== 'tracker.md' && !n.startsWith('.') && !n.startsWith('_')
  )

  const channels = await Promise.all(files.map(async (filename): Promise<Channel | null> => {
    const abs = path.join(PATHS.partnerships, filename)
    let raw: string
    try {
      raw = await fs.readFile(abs, 'utf-8')
    } catch {
      return null
    }
    try {
      const { data, content } = matter(raw)
      const slug = typeof data.slug === 'string' && data.slug ? data.slug : filename.replace(/\.md$/, '')
      const lastTouchedAt = await lastTouched(abs, data)
      const daysSinceTouch = lastTouchedAt
        ? Math.floor((Date.now() - new Date(lastTouchedAt).getTime()) / 86_400_000)
        : null
      const staleness: ChannelStaleness =
        daysSinceTouch === null ? 'unknown' :
        daysSinceTouch >= CHANNEL_COLD_DAYS ? 'cold' :
        daysSinceTouch >= CHANNEL_WARN_DAYS ? 'warn' :
        'fresh'
      return {
        slug,
        name: typeof data.name === 'string' && data.name ? data.name : slug,
        type: typeof data.type === 'string' ? data.type.toLowerCase() : 'channel',
        isVehicle: data.type === 'vehicle',
        status: typeof data.status === 'string' ? data.status.toLowerCase() : 'unknown',
        entity: typeof data.entity === 'string' ? data.entity : undefined,
        owner: typeof data.owner === 'string' ? data.owner : undefined,
        blockedOn: typeof data.blocked_on === 'string' ? data.blocked_on : undefined,
        nextActions: extractNextActions(content),
        lastTouchedAt,
        daysSinceTouch,
        staleness,
        body: content,
      }
    } catch {
      return null // corrupt frontmatter — skip the file, never the page
    }
  }))

  // Vehicles first (the moat), then by how much attention each needs.
  const rank = (c: Channel) =>
    (c.status === 'blocked' ? 0 : c.staleness === 'cold' ? 1 : c.staleness === 'warn' ? 2 : 3)
  return channels
    .filter((c): c is Channel => c !== null)
    .sort((a, b) =>
      Number(b.isVehicle) - Number(a.isVehicle) || rank(a) - rank(b) || a.name.localeCompare(b.name)
    )
}

/**
 * The channels that belong on Today: blocked, or provably cold. 'unknown' is
 * excluded — a missing date must not cry wolf — and dormant-by-choice still
 * alerts when cold, because dormant was the SLP's exact failure mode.
 */
export function channelAlerts(channels: Channel[]): Channel[] {
  return channels.filter(c => c.status === 'blocked' || c.staleness === 'cold')
}
