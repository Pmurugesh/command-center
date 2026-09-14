/**
 * Watch the four pages that move California's AI-and-procurement ground, and
 * say only what changed on them.
 *
 * The `daily-intel-scan` cron was an agentTurn around `research-scan.sh`, which
 * had been SIGKILL'd every run for a month (the 2026-09-13 briefing says so in
 * its own header). A model was being asked to notice change on pages it could
 * not reach. Change detection does not need a model: fetch, strip to text,
 * hash, diff against the last stored text. That is all this does.
 *
 * Each source keeps one file, intelligence/watch/<slug>.md: the hash in
 * frontmatter is what the next run compares against, the `## Changes` section
 * is the human-readable delta, and `## Snapshot` is the text the delta was
 * computed from. Unchanged sources write nothing, so the janitor has nothing to
 * commit and, under --on-change, stdout stays empty and OpenClaw skips the
 * announce. A fetch that fails never touches a stored snapshot.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/watch-sources.ts [--on-change] [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import matter from 'gray-matter'
import { PATHS } from '../src/lib/paths.ts'
import { runCommandArgs } from '../src/lib/shell.ts'
import { atomicWrite } from '../src/lib/store.ts'
import { localToday } from '../src/lib/dates.ts'

const DRY = process.argv.includes('--dry')
const ON_CHANGE = process.argv.includes('--on-change')
const FETCH_TIMEOUT_MS = 15_000
const DIFF_LINES = 40
const WATCH_DIR = path.join(PATHS.intelligenceBase, 'watch')
const SNAPSHOT_HEADING = '## Snapshot'

interface Source { slug: string; name: string; url: string }

// A fixed list on purpose. Adding a source is a code change with a reviewer,
// not a config edit nobody sees. The URLs were each confirmed to resolve 200
// on 2026-09-14; cdt.ca.gov/news redirects to www, so the canonical host is
// stored rather than the redirect.
const SOURCES: Source[] = [
  { slug: 'cdt-news', name: 'CDT newsroom', url: 'https://www.cdt.ca.gov/news/' },
  { slug: 'gov-newsroom', name: "Governor's newsroom", url: 'https://www.gov.ca.gov/newsroom/' },
  { slug: 'dgs-slp', name: 'DGS Software Licensing Program',
    url: 'https://www.dgs.ca.gov/PD/About/Page-Content/PD-Branch-Intro-Accordion-List/Acquisitions/Software-Licensing-Program' },
  { slug: 'ab-412', name: 'AB 412 (leginfo)',
    url: 'https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB412' },
]

// ── fetch and normalise ─────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: { 'user-agent': 'command-center watch-sources/1.0 (+https://github.com/Pmurugesh/command-center)', accept: 'text/html' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * Visible text, one trimmed line per block element. Scripts, styles and
 * comments go first because that is where per-request nonces and build ids
 * live; leaving them in would make every page "change" on every fetch.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|nav|ul|ol|table|dd|dt|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENTITIES[code.toLowerCase()] ?? m
    })
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')

// ── stored snapshot ─────────────────────────────────────────────────────────

interface Stored { hash: string; text: string }

async function readStored(slug: string): Promise<Stored | null> {
  let raw: string
  try { raw = await fs.readFile(path.join(WATCH_DIR, `${slug}.md`), 'utf-8') } catch { return null }
  const { data, content } = matter(raw)
  const idx = content.indexOf(`\n${SNAPSHOT_HEADING}\n`)
  return {
    hash: String(data.hash ?? ''),
    text: idx === -1 ? '' : content.slice(idx + SNAPSHOT_HEADING.length + 2).trim(),
  }
}

/**
 * Set difference by line, in page order: what appeared, then what vanished.
 * Not a real diff, and does not need to be — the question is "what is new on
 * this page", and a moved paragraph is not news.
 */
export function lineDelta(prev: string, next: string): { added: string[]; removed: string[] } {
  const a = prev ? prev.split('\n') : []
  const b = next.split('\n')
  const inA = new Set(a), inB = new Set(b)
  return { added: b.filter(l => !inA.has(l)), removed: a.filter(l => !inB.has(l)) }
}

function render(src: Source, hash: string, text: string, delta: { added: string[]; removed: string[] }, firstRun: boolean, now: string): string {
  const total = delta.added.length + delta.removed.length
  const shown = [...delta.added.map(l => `+ ${l}`), ...delta.removed.map(l => `- ${l}`)]
    .slice(0, DIFF_LINES).map(l => l.replace(/`/g, "'"))
  const body: string[] = [`# ${src.name}`, '', `<${src.url}>`, '']
  if (firstRun) {
    body.push(`## Changes`, '', `First capture, ${text.split('\n').length} lines. Deltas start with the next change.`, '')
  } else {
    body.push(`## Changes (${total} lines, ${localToday()})`, '')
    if (total === 0) body.push('Text reordered; no line added or removed.', '')
    else body.push('```diff', ...shown, '```', '')
    if (total > shown.length) body.push(`${total - shown.length} more lines changed; compare git history of this file.`, '')
  }
  body.push(SNAPSHOT_HEADING, '', text, '')
  return matter.stringify(body.join('\n'), { url: src.url, hash, checked_at: now, changed_at: now })
}

// ── main ────────────────────────────────────────────────────────────────────

async function watch(src: Source): Promise<{ changed: boolean; failed: boolean }> {
  let text: string
  try {
    text = htmlToText(await fetchHtml(src.url))
  } catch (e) {
    console.error(`${src.slug}: fetch failed, snapshot kept: ${String(e).replace(/\s+/g, ' ').slice(0, 160)}`)
    return { changed: false, failed: true }
  }
  if (!text) {
    // An empty page is a broken fetch wearing a 200, not a change.
    console.error(`${src.slug}: fetched no text, snapshot kept`)
    return { changed: false, failed: true }
  }
  const hash = sha1(text)
  const stored = await readStored(src.slug)
  if (stored && stored.hash === hash) {
    if (!ON_CHANGE) console.log(`${src.slug} unchanged`)
    return { changed: false, failed: false }
  }

  const delta = lineDelta(stored?.text ?? '', text)
  const n = stored ? delta.added.length + delta.removed.length : text.split('\n').length
  const file = path.join(WATCH_DIR, `${src.slug}.md`)
  if (!DRY) {
    await atomicWrite(file, render(src, hash, text, delta, !stored, new Date().toISOString()))
    const rel = path.relative(PATHS.operationsRoot, file)
    try {
      await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
      await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'commit', '-q',
        '-m', `intel: watch ${src.slug}`, '-m', 'via: watch-sources', '--', rel], 15_000)
    } catch { /* the janitor sweeps */ }
  }
  console.log(`${src.slug} changed (${n} lines)${stored ? '' : ', first capture'}${DRY ? ' [dry]' : ''}`)
  return { changed: true, failed: false }
}

async function main() {
  const results = await Promise.all(SOURCES.map(watch))
  // A source that cannot be fetched is a failure, not a quiet run: exit non-zero
  // so the cron's failure alert (2 consecutive errors) is the thing that speaks.
  if (results.some(r => r.failed)) process.exit(1)
}

main().catch(err => { console.error('watch-sources failed:', err); process.exit(1) })
