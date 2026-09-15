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
 * INFINITE SOLUTIONS LENS. The consulting rules are not in gtm/lead-rules.md;
 * they live in qual_table_automations (eprocure_relevance, CONSULTING lens) and
 * only run on the mini, inside scripts/caleprocure-scan.py. That scan writes
 * intelligence/procurements/<date>-caleprocure.json with both verdicts for
 * every open event, and the second half of this script ingests its shortlist
 * band (score >= 40) as `-is` leads. Nothing here scores the consulting lens;
 * without a sidecar that half simply reports there is none yet.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *        scripts/sync-leads.ts [--dry]
 */
import { syncLeads, syncConsultingLeads, readLatestSidecar, IS_SHORTLIST_SCORE } from '../src/lib/leads.ts'
import { scoreEvents } from '../src/lib/lead-scoring.ts'
import { getQualTableConfig, signIn, fetchJson, QUAL_TABLE_CONFIG_HELP } from '../src/lib/qual-table.ts'
import type { QualTableConfig } from '../src/lib/qual-table.ts'

const DRY = process.argv.includes('--dry')
// --on-change: hold the progress lines and print nothing when no lead was
// created or updated, so the cron's announce is skipped (see sync-bids.ts).
const ON_CHANGE = process.argv.includes('--on-change')
const held: string[] = []
const say = (line: string) => { if (ON_CHANGE) held.push(line); else console.log(line) }
const flush = () => { for (const l of held) console.log(l); held.length = 0 }

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

  say('signing in…')
  const token = await signIn(config)
  say('fetching (read-only, scope=all)…')
  const remote = await fetchEvents(config, token)
  say(`fetched ${remote.length} events`)

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
  say(`${enriched}/${events.length} carry description or commodity codes (the rest score provisionally)`)

  const sidecar = await readLatestSidecar()
  const consulting = (sidecar?.events ?? []).filter(e => (e.lenses?.consulting?.score ?? 0) >= IS_SHORTLIST_SCORE)
  say(sidecar
    ? `${sidecar.file}: ${sidecar.events.length} open events, ${consulting.length} on the Infinite Solutions shortlist`
    : 'no caleprocure sidecar yet (scripts/caleprocure-scan.py writes it on the mini) — consulting lens skipped')

  if (DRY) {
    const scored = await scoreEvents(events)
    const shown = scored.filter(s => s.verdict.bucket !== 'unlikely').slice(0, 25)
    console.log(`\n[dry run] ${shown.length} would surface for InfiniteAI:\n`)
    for (const s of shown) {
      const v = s.verdict
      const icon = v.bucket === 'likely' ? '🟢' : '🟡'
      const tier = v.tiers.includes('have') ? 'SELL' : v.tiers.includes('adjacent') ? 'SCOPE' : v.tiers.includes('could-build') ? 'BUILD' : '—'
      console.log(`${icon} ${String(v.score).padStart(3)} [${tier.padEnd(5)}] ${s.eventName.slice(0, 60)}`)
      console.log(`            ${v.products.join(', ') || 'no product match'}${v.provisional ? '  (provisional)' : ''}`)
    }
    console.log(`\n[dry run] ${consulting.length} would surface for Infinite Solutions:\n`)
    for (const e of consulting.slice(0, 25)) {
      const c = e.lenses.consulting!
      console.log(`🟢 ${String(c.score).padStart(3)} [IS   ] ${e.name.slice(0, 60)}`)
      console.log(`            ${c.reasons.slice(0, 3).join('; ') || 'no individual rule fired'}`)
    }
    return
  }

  const outcome = await syncLeads(events, 'lead-sync')
  const isOutcome = sidecar ? await syncConsultingLeads(sidecar.events, 'lead-sync') : null
  const changed = (o: typeof outcome | null) => Boolean(o && (o.created || o.updated))
  if (ON_CHANGE && !changed(outcome) && !changed(isOutcome)) return   // nothing to announce
  flush()
  for (const [label, o] of [['InfiniteAI', outcome], ['Infinite Solutions', isOutcome]] as const) {
    if (!o) continue
    console.log(`\n${label}: created ${o.created}, updated ${o.updated}, unchanged ${o.unchanged}, already closed ${o.expired}`)
    for (const r of o.reasons.slice(0, 20)) console.log(`  ${r.slug}: ${r.why}`)
  }
}

main().catch(e => { console.error(String(e)); process.exit(1) })
