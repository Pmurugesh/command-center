/**
 * Parse one `voice-monday-content-ideas` run into suggestion files.
 *
 * Voice announces its weekly ideas as prose. Going forward it writes the files
 * itself (the cron prompt says so), but the runs already sitting in the cron
 * log only exist as that prose — this turns them into real suggestions so the
 * dashboard has history on day one.
 *
 *   node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *     scripts/import-content-suggestions.ts --from <file.md> --week YYYY-MM-DD [--dry]
 *
 * Flags rather than positionals: run-ts.mjs shifts argv, and every other script
 * in here reads flags, so this stays consistent and unambiguous.
 *
 * Parsing an LLM's prose is fragile by nature, so this is strict: a block that
 * doesn't yield an entity and a topic is reported and skipped, never guessed at.
 */

import fs from 'fs/promises'
import path from 'path'
import { PATHS } from '../src/lib/paths'
import { serialize } from '../src/lib/content'
import type { ContentSuggestion } from '../src/types'

function flag(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? '') : ''
}

const srcArg = flag('from')
const weekArg = flag('week')
const dry = process.argv.includes('--dry')

if (!srcArg || !/^\d{4}-\d{2}-\d{2}$/.test(weekArg)) {
  console.error('usage: import-content-suggestions.ts --from <file.md> --week YYYY-MM-DD [--dry]')
  process.exit(1)
}

function slug(s: string, max = 40): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')   // slicing can land mid-word; don't leave a dangling dash
}

/**
 * Trailing `---` horizontal rules separate Voice's post blocks, so the LAST
 * field in each block runs straight into one. Strip them, or every
 * strategic_value ends with a stray rule in its frontmatter.
 */
function clean(v: string): string {
  return v.replace(/\n\s*-{3,}\s*$/, '').trim()
}

/** `**Field:** value` up to the next bold field or heading. */
function field(block: string, name: string): string {
  const re = new RegExp(`\\*\\*${name}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|\\n## |$)`, 'i')
  const m = block.match(re)
  return m ? clean(m[1]) : ''
}

/** `**Hook:**` sits on its own line with the quoted text beneath it. */
function hookOf(block: string): string {
  const m = block.match(/\*\*Hook:\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n## |$)/i)
  return m ? clean(m[1]).replace(/^"|"$/g, '').trim() : ''
}

const raw = await fs.readFile(path.resolve(srcArg), 'utf-8')

// Split on "## POST n: Entity" — the shape the Monday prompt asks for.
const blocks = raw.split(/\n(?=## POST\b)/i).filter(b => /^## POST\b/i.test(b.trim()))
if (blocks.length === 0) {
  console.error('No "## POST" blocks found — nothing to import.')
  process.exit(1)
}

const written: string[] = []
const skipped: string[] = []

for (const block of blocks) {
  const header = block.match(/^## POST\s*(\d+)\s*(\(([^)]*)\))?\s*:\s*(.+)$/im)
  if (!header) { skipped.push(block.slice(0, 60).replace(/\n/g, ' ')); continue }

  const postNumber = parseInt(header[1], 10) || 0
  const marker = (header[3] || '').toLowerCase()
  const entity = header[4].trim()
  const topic = field(block, 'Topic')

  if (!entity || !topic) { skipped.push(`POST ${postNumber}: missing entity or topic`); continue }

  const s: ContentSuggestion = {
    id: `${weekArg}-${String(postNumber).padStart(2, '0')}-${slug(entity, 20)}-${slug(topic, 36)}`,
    week: weekArg,
    postNumber,
    entity,
    day: field(block, 'Day'),
    topic,
    signalSource: field(block, 'Signal Source'),
    strategicValue: field(block, 'Strategic value'),
    hook: hookOf(block),
    angle: field(block, 'Draft angle'),
    status: 'suggested',
    optional: /optional|backlog/.test(marker),
    generatedAt: new Date(`${weekArg}T08:00:00-07:00`).toISOString(),
  }

  const dest = path.join(PATHS.contentSuggestions, `${s.id}.md`)
  if (dry) {
    console.log(`would write ${path.basename(dest)}`)
    console.log(`   entity=${s.entity} day=${s.day} optional=${s.optional}`)
    console.log(`   hook=${s.hook.slice(0, 80)}`)
  } else {
    await fs.mkdir(PATHS.contentSuggestions, { recursive: true })
    await fs.writeFile(dest, serialize(s), 'utf-8')
  }
  written.push(path.basename(dest))
}

console.log(`\n${dry ? 'DRY RUN — ' : ''}${written.length} suggestion(s) for week ${weekArg}`)
for (const w of written) console.log('  ✓', w)
if (skipped.length) {
  console.log(`\n${skipped.length} block(s) SKIPPED (not guessed at):`)
  for (const s of skipped) console.log('  ✗', s)
}
