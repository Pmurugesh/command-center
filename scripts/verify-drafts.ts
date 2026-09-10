/**
 * Fail if any outreach draft on disk contains content that must not be sent.
 *
 * The dashboard's own writeDraft() enforces this at write time, but drafts can
 * also arrive by other routes — an agent writing the file directly (which is
 * how crm/drafts/pindi-oeis.md was created), or a hand edit. Those bypass the
 * write-time guard entirely, so the queue itself gets swept here.
 *
 * Exit 1 on any leak in an UNSENT draft — those are still preventable. A sent
 * email is history and cannot be unsent, so it is reported and does not fail
 * the gate: a check that is permanently red is a check nobody reads.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/verify-drafts.ts
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from '../src/lib/paths.ts'
import { findInternalLeaks } from '../src/lib/followup.ts'
import { getContact } from '../src/lib/crm.ts'

const files = await fs.readdir(PATHS.crmDrafts).catch(() => [] as string[])
const drafts = files.filter(f => f.endsWith('.md') && !f.startsWith('.'))

let failed = 0
let alreadySent = 0
for (const file of drafts) {
  const slug = file.replace(/\.md$/, '')
  const raw = await fs.readFile(path.join(PATHS.crmDrafts, file), 'utf-8')
  const { content, data } = matter(raw)
  const contact = await getContact(slug).catch(() => null)
  const leaks = findInternalLeaks(content.trim(), contact)
  const state = data.status === 'sent' ? 'SENT' : 'draft'

  if (leaks.length > 0 && state === 'SENT') {
    alreadySent++
    console.warn(`! ${file} [SENT] — already delivered, recorded not gated`)
    for (const l of leaks) console.warn(`    · ${l}`)
  } else if (leaks.length > 0) {
    failed++
    console.error(`✗ ${file} [${state}]`)
    for (const l of leaks) console.error(`    · ${l}`)
  } else {
    console.log(`✓ ${file} [${state}]`)
  }
}

console.log(`\n${drafts.length} draft(s) checked · ${failed} unsent with leaks · ${alreadySent} already sent with leaks.`)
if (failed > 0) {
  console.error('\nA draft in the queue contains content that must not be sent.')
  process.exit(1)
}
