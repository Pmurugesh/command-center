/**
 * Regenerate `intelligence/priority-outreach.md` as a VIEW of the contact store.
 *
 * The 8am sales brief (Capture's cron) reads this path. It was hand-written
 * once and died in May 2026 — the brief kept reading it anyway, which is the
 * M4 bug this script retires: agents keep the path they already know, but the
 * content is now derived, so it can never go stale while the store moves.
 *
 * Runs on the mini as the last step of the 15-minute intake tick. Writes and
 * commits ONLY when content actually changed (the generated_at line is
 * excluded from the comparison), so a quiet day adds zero commits.
 *
 * The "Pending action items from email" section is gone (2026-09-14): it was a
 * one-shot extraction from the Aug 24/26 sweep with no resolution path, and six
 * of its items had already been answered. The brief now reads the store only.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/generate-outreach.ts
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS, OUTREACH_PATH } from '../src/lib/paths.ts'
import { getBuckets, today } from '../src/lib/crm.ts'
import { listPending } from '../src/lib/intake-review.ts'
import { runCommandArgs } from '../src/lib/shell.ts'
import type { CrmContactView } from '../src/types/index.ts'

function line(c: CrmContactView, counter?: string | undefined): string {
  const bits = [
    `**${c.name}**`,
    c.agencyName || c.agency || '',
    c.owner ? `owner: ${c.owner}` : '',
    counter || '',
    c.nextAction ? `→ ${c.nextAction}` : '',
    c.blockedOn ? `⛔ ${c.blockedOn}` : '',
  ].filter(Boolean)
  return `- ${bits.join(' · ')}`
}

async function main() {
  const b = await getBuckets()
  const review = await listPending()

  const s: string[] = [
    '# Priority outreach — GENERATED VIEW, DO NOT HAND-EDIT',
    '',
    '<!-- Derived from crm/contacts by scripts/generate-outreach.ts on every',
    '     intake tick. Hand edits are overwritten within 15 minutes. To change',
    '     what appears here, change the contacts (dashboard or crm API). -->',
    `generated_at: ${new Date().toISOString()}`,
    '',
  ]
  const section = (title: string, rows: string[]) => {
    if (!rows.length) return
    s.push(`## ${title}`, '', ...rows, '')
  }

  section(`Overdue (${b.overdue.length})`,
    b.overdue.map(c => line(c, `${c.daysOverdue}d overdue`)))
  section(`Blocked (${b.blocked.length})`,
    b.blocked.map(c => line(c, c.daysBlocked !== undefined ? `${c.daysBlocked}d blocked` : undefined)))
  section(`Due today (${b.dueToday.length})`, b.dueToday.map(c => line(c)))
  section(`Going cold (${b.goingCold.length})`,
    b.goingCold.map(c => line(c, `${c.daysSinceTouch}d since touch`)))

  if (review.length) {
    s.push(`## Review queue`, '',
      `- ${review.length} correspondent(s) await a human decision on the dashboard /intake page`, '')
  }
  if (!b.overdue.length && !b.blocked.length && !b.dueToday.length
      && !b.goingCold.length && !review.length) {
    s.push('_Nothing needs attention — the store is clear today._', '')
  }
  s.push(`_${b.total} contacts tracked · ${b.sourcedCount} sourced-not-pursued · as of ${today()}_`, '')

  const next = s.join('\n')
  const strip = (t: string) => t.split('\n').filter(l => !l.startsWith('generated_at:')).join('\n')
  let current = ''
  try { current = await fs.readFile(OUTREACH_PATH, 'utf8') } catch { /* first run */ }
  if (strip(current) === strip(next)) {
    console.log('outreach view: unchanged')
    return
  }

  await fs.writeFile(OUTREACH_PATH, next)
  const rel = path.relative(PATHS.operationsRoot, OUTREACH_PATH)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `outreach: regenerate view (${b.overdue.length} overdue, ${b.blocked.length} blocked)`,
      '-m', 'via: generate-outreach', '--', rel,
    ], 15_000)
  } catch { /* janitor sweeps */ }
  console.log(`outreach view: regenerated (${b.overdue.length} overdue, ${b.blocked.length} blocked, ${b.dueToday.length} due, ${b.goingCold.length} cold)`)
}

main().catch(err => { console.error('generate-outreach failed:', err); process.exit(1) })
