/**
 * Mirror the qual-table workbench's bids into operations/bids/<folder>/.status.json.
 *
 * STRICTLY READ-ONLY AGAINST THEIR APP: one call, `GET /api/v1/bids/summary`.
 * Never the Brief from a cron, never a POST. Status changes happen in their UI
 * and arrive here within the hour. See
 * operations/workflows/unified-bid-system-handoff.md.
 *
 * Failure renders unknown: a timeout or a bad response writes nothing and logs
 * one line to ~/.openclaw/logs/bid-sync.log; the Today freshness row reads the
 * last success from that log.
 *
 * Exit codes: 0 synced · 1 fetch or write failed · 2 not configured.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *        scripts/sync-bids.ts [--dry]
 */
import { syncBids, mapRemote, appendBidSyncLog } from '../src/lib/bid-sync.ts'
import type { RemoteBid } from '../src/lib/bid-sync.ts'
import { getQualTableConfig, signIn, fetchJson, QUAL_TABLE_CONFIG_HELP } from '../src/lib/qual-table.ts'

const DRY = process.argv.includes('--dry')

interface Summary {
  open_bids?: number
  due_within_7_days?: number
  pipeline_value?: number
  bids?: RemoteBid[]
}

async function main() {
  const config = getQualTableConfig()
  if (!config) {
    for (const line of QUAL_TABLE_CONFIG_HELP) console.error(line)
    process.exit(2)
  }

  let summary: Summary
  try {
    console.log('signing in…')
    const token = await signIn(config)
    console.log('fetching (read-only) /api/v1/bids/summary…')
    summary = await fetchJson<Summary>(config, token, '/api/v1/bids/summary')
  } catch (e) {
    const msg = String(e).replace(/\s+/g, ' ').slice(0, 200)
    if (!DRY) await appendBidSyncLog(`error ${msg}`)
    console.error(msg)
    process.exit(1)
  }

  const rows = summary.bids ?? []
  console.log(`fetched ${rows.length} bids (workbench counts ${summary.open_bids ?? '?'} open, ${summary.due_within_7_days ?? '?'} due within 7 days)`)

  if (DRY) {
    console.log('\n[dry run] mapping only, nothing written:\n')
    for (const r of rows) {
      const m = mapRemote(r)
      console.log(`#${String(r.bid_id).padStart(4)} ${String(r.status).padEnd(9)} ${(r.due_date ?? '—').padEnd(10)} → ${m.status.padEnd(12)} ${m.stage.padEnd(16)} ${r.display_name.slice(0, 50)}`)
    }
    return
  }

  try {
    const outcome = await syncBids(rows, 'bid-sync')
    await appendBidSyncLog(`ok fetched=${rows.length} created=${outcome.created} updated=${outcome.updated} unchanged=${outcome.unchanged}`)
    console.log(`\ncreated ${outcome.created}, updated ${outcome.updated}, unchanged ${outcome.unchanged}`)
    for (const c of outcome.changes.slice(0, 30)) console.log(`  ${c.folder} (#${c.bidId}): ${c.why}`)
  } catch (e) {
    const msg = String(e).replace(/\s+/g, ' ').slice(0, 200)
    await appendBidSyncLog(`error write ${msg}`)
    console.error(msg)
    process.exit(1)
  }
}

main().catch(async e => { await appendBidSyncLog(`error ${String(e).slice(0, 200)}`); console.error(String(e)); process.exit(1) })
