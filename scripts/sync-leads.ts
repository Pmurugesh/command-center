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

const DRY = process.argv.includes('--dry')

interface Config {
  apiUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  email: string
  password: string
}

/**
 * Read from the environment only. Mirrors their own `is_enabled` gate: an
 * unconfigured deploy exits cleanly rather than half-working.
 */
function getConfig(): Config | null {
  const c = {
    apiUrl: (process.env.QUAL_TABLE_API_URL ?? '').replace(/\/+$/, ''),
    supabaseUrl: (process.env.QUAL_TABLE_SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseAnonKey: process.env.QUAL_TABLE_SUPABASE_ANON_KEY ?? '',
    email: process.env.QUAL_TABLE_EMAIL ?? '',
    password: process.env.QUAL_TABLE_PASSWORD ?? '',
  }
  return Object.values(c).every(Boolean) ? c : null
}

/**
 * Exchange the service-account credentials for a short-lived access token.
 * Done per run because Supabase access tokens expire in about an hour, so a
 * stored token would break a scheduled sync by the next day.
 */
async function signIn(c: Config): Promise<string> {
  const res = await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: c.supabaseAnonKey },
    body: JSON.stringify({ email: c.email, password: c.password }),
  })
  if (!res.ok) throw new Error(`sign-in failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const body = await res.json() as { access_token?: string }
  if (!body.access_token) throw new Error('sign-in returned no access_token')
  return body.access_token
}

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

async function fetchEvents(c: Config, token: string): Promise<RemoteEvent[]> {
  // scope=all, NOT scope=shortlist: their shortlist is the staffing lens, and
  // filtering by it would hide exactly the product opportunities we exist to find.
  const url = `${c.apiUrl}/api/v1/discovery/events?scope=all&limit=1000`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error('401 — the service account is not authorised')
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const body = await res.json() as { events?: RemoteEvent[]; total?: number }
  const events = body.events ?? []
  // Their list is capped at the server's 1000-row maximum; say so rather than
  // silently reporting a truncated set as complete.
  if (body.total && body.total > events.length) {
    console.warn(`NOTE: ${body.total} events exist, ${events.length} returned (server cap). Paging needed.`)
  }
  return events
}

async function main() {
  const config = getConfig()
  if (!config) {
    console.error('Not configured. Set on the mini:')
    console.error('  QUAL_TABLE_API_URL           the qual-table Render URL')
    console.error('  QUAL_TABLE_SUPABASE_URL      its Supabase project URL')
    console.error('  QUAL_TABLE_SUPABASE_ANON_KEY its anon key (not secret)')
    console.error('  QUAL_TABLE_EMAIL             the Paladin service account')
    console.error('  QUAL_TABLE_PASSWORD          its password')
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
