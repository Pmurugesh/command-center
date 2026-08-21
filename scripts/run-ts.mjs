/**
 * Run a TypeScript script against the app's own src/lib modules.
 *   node --experimental-strip-types --no-warnings scripts/run-ts.mjs <script.ts> [args]
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

register('./_ts-resolver.mjs', import.meta.url)

const target = process.argv[2]
if (!target) {
  console.error('usage: run-ts.mjs <script.ts> [args...]')
  process.exit(1)
}
await import(pathToFileURL(path.resolve(target)).href)
