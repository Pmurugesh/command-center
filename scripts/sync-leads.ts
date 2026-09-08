/**
 * Pull discovered solicitations from the qual-table app and score them through
 * the InfiniteAI product lens.
 *
 * STRICTLY READ-ONLY AGAINST THEIR APP. This makes exactly one kind of call to
 * them: `GET /discovery/events`. It never triggers a refresh and never enriches.
 *
 * WHY THAT MATTERS, and why it is enforced here rather than left to discipline:
 * their discovery data is ORG-WIDE, not per-user (their own tracker defers
 * per-user "seen" state, and `first_seen_run_id` is shared). So a refresh
 * consumes a request budget other people rely on, and an enrich RE-SCORES the
 * row with THEIR rules — meaning rows could move in and out of the Infinite
 * Solutions shortlist with nobody on that team having touched anything. Their
 * design notes call that exact behaviour out as a bug they restructured to
 * avoid. Reintroducing it from outside their app would be worse than useless.
 *
 * Adding a write here is a decision to make WITH that team, not a code change.
 *
 * Consequence to accept: we see every event at list level, but only the ones
 * their lens already promoted carry a description and commodity codes, because
 * enrichment is bounded per run and prioritised by their buckets. Ours score
 * `provisional` until then — see operations/gtm/lead-search-handoff.md for the
 * terms that would widen their enrichment and fix this at the source.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *        scripts/sync-leads.ts [--dry]
 */
import { syncLeads } from '../src/lib/leads.ts'
import { scoreEvents } from '../src/lib/lead-scoring.ts'
import { getQualTableConfig, signIn, fetchJson, QUAL_TABLE_CONFIG_HELP } from '../src/lib/qual-table.ts'
import type { QualTableConfig } from '../src/lib/qual-table.ts'

const DRY = process.argv.includes('--dry')

interface RemoteEvent {
  business_unit: string
  event_id: string
  event_version?: number
  event_name: string
  department_name?: string
  description?: string
  unspsc_codes?: string[]
  event_type?: string
  end_date?: string
  triage_status?: string
}

async function fetchEvents(c: QualTableConfig, token: string): Promise<RemoteEvent[]> {
  // scope=all, NOT scope=shortlist: their shortlist is the staffing lens, and
  // filtering by it would hide exactly the product opportunities we exist to find.
  // The shared client carries the 20 s timeout; before 2026-09-08 this call had none.
  const body = await fetchJson<{ events?: RemoteEvent[]; total?: number }>(
    c, token, '/api/v1/discovery/events?scope=all&limit=1000',
  )
  const events = body.events ?? []
  // Their list is capped at the server's 1000-row maximum; say so rather than
  // silently reporting a truncated set as complete.
  if (body.total && body.total > events.length) {
    console.warn(`NOTE: ${body.total} events exist, ${events.length} returned (server cap). Paging needed.`)
  }
  return events
}

async function main() {
  const config = getQualTableConfig()
  if (!config) {
    for (const line of QUAL_TABLE_CONFIG_HELP) console.error(line)
    process.exit(2)
  }

  console.log('signing in…')
  const token = await signIn(config)
  console.log('fetching (read-only, scope=all)…')
  const remote = await fetchEvents(config, token)
  console.log(`fetched ${remote.length} events`)

  const events = remote.map(e => ({
    businessUnit: e.business_unit,
    eventId: e.event_id,
    eventVersion: e.event_version,
    eventName: e.event_name,
    departmentName: e.department_name,
    description: e.description,
    unspscCodes: e.unspsc_codes,
    eventType: e.event_type,
    endDate: e.end_date ? String(e.end_date).slice(0, 10) : undefined,
    source: 'caleprocure',
  }))

  const enriched = events.filter(e => e.description || e.unspscCodes?.length).length
  console.log(`${enriched}/${events.length} carry description or commodity codes (the rest score provisionally)`)

  if (DRY) {
    const scored = await scoreEvents(events)
    const shown = scored.filter(s => s.verdict.bucket !== 'unlikely').slice(0, 25)
    console.log(`\n[dry run] ${shown.length} would surface:\n`)
    for (const s of shown) {
      const v = s.verdict
      const icon = v.bucket === 'likely' ? '🟢' : '🟡'
      const tier = v.tiers.includes('have') ? 'SELL' : v.tiers.includes('adjacent') ? 'SCOPE' : v.tiers.includes('could-build') ? 'BUILD' : '—'
      console.log(`${icon} ${String(v.score).padStart(3)} [${tier.padEnd(5)}] ${s.eventName.slice(0, 60)}`)
      console.log(`            ${v.products.join(', ') || 'no product match'}${v.provisional ? '  (provisional)' : ''}`)
    }
    return
  }

  const outcome = await syncLeads(events, 'lead-sync')
  console.log(`\ncreated ${outcome.created}, updated ${outcome.updated}, unchanged ${outcome.unchanged}`)
  for (const r of outcome.reasons.slice(0, 20)) console.log(`  ${r.slug}: ${r.why}`)
}

main().catch(e => { console.error(String(e)); process.exit(1) })
