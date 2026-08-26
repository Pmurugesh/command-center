/**
 * Rebuild the content feedback digest from what's on disk.
 *
 * The dashboard rewrites this on every pick/skip/feedback, so it should never
 * need running by hand — this exists for repair (a hand-edited suggestion, a
 * bulk import, a file restored from git) and to inspect what Voice will read.
 *
 *   node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *     scripts/content-digest.ts [--print]
 */

import path from 'path'
import { refreshDigest, DIGEST_FILE } from '../src/lib/content'
import { PATHS } from '../src/lib/paths'

const body = await refreshDigest()
const dest = path.join(PATHS.content, DIGEST_FILE)

if (process.argv.includes('--print')) {
  console.log(body)
  console.log('\n---')
}
console.log(`digest written: ${dest} (${body.length} bytes)`)
