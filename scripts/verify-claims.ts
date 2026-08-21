/**
 * Verify that operations' customer-facing claims still match the codebase.
 *
 * Why this exists: `bids/_platform-knowledge.md` describes itself as a living
 * document "updated automatically after each bid analysis". It was last updated
 * 2026-03-23. It is the evidence base for capability claims made to the State of
 * California in bid responses, and on 2026-08-21 an audit found 18 of its 121
 * cited code paths no longer existed. Nothing checked, so nobody knew.
 *
 * The mechanism is simple and general: a claim that cites evidence can be
 * verified mechanically. Every backticked code path in operations markdown is
 * treated as a citation and resolved against the platform repo. A citation that
 * no longer resolves is either a rename to chase or a capability that quietly
 * went away — both are things sales must know before a bid goes out.
 *
 * This checks that citations RESOLVE, not that prose is true. It cannot tell you
 * whether "6 export formats" is still accurate; it can tell you the file that
 * claim points at is gone. That is most of the value for a fraction of the work.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/verify-claims.ts [--gate]
 *       --gate exits non-zero when bid-facing files have dead citations, so it
 *       can block a submission in CI or a pre-bid check.
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { PATHS } from '../src/lib/paths.ts'

const PLATFORM = path.join(os.homedir(), 'infiniteai_platform')
const GATE = process.argv.includes('--gate')

// Files whose claims reach a customer. A dead citation here is a live risk, not
// housekeeping — these get the gate treatment.
const BID_FACING = [/_platform-knowledge\.md$/, /_response-library\//, /bids\/.*\/response/i]

// Citations look like `packages/api/app/thing.py` or `path.py::function()`.
const CITATION = /`([a-zA-Z0-9_][a-zA-Z0-9_./-]*\.(?:py|ts|tsx|sql|ya?ml))(?:::[^`]*)?`/g

interface Dead { file: string; citation: string; bidFacing: boolean }

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/**
 * Repo-relative file list from the platform's MAIN branch.
 *
 * Deliberately not `git ls-files`: that reads whatever branch is checked out, so
 * the answer would change depending on what someone was working on. Shipped
 * capability means what is on main. Falls back to the working tree only if main
 * cannot be resolved (e.g. a fresh clone with no remote).
 */
async function gitFiles(repo: string): Promise<{ files: string[]; ref: string }> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const opts = { maxBuffer: 64 * 1024 * 1024 }
  for (const ref of ['origin/main', 'main']) {
    try {
      const { stdout } = await run('git', ['-C', repo, 'ls-tree', '-r', '--name-only', ref], opts)
      const files = stdout.split('\n').filter(Boolean)
      if (files.length) return { files, ref }
    } catch { /* try the next ref */ }
  }
  try {
    const { stdout } = await run('git', ['-C', repo, 'ls-files'], opts)
    return { files: stdout.split('\n').filter(Boolean), ref: 'working tree (main unavailable)' }
  } catch {
    return { files: [], ref: 'none' }
  }
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, out)
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

async function main() {
  if (!(await exists(PLATFORM))) {
    console.error(`platform repo not found at ${PLATFORM} — cannot verify citations`)
    process.exit(2)
  }

  // Index the platform's files ONCE. The first version resolved bare filenames
  // by walking the whole repo per citation — O(citations x repo), which took
  // minutes. Build the basename index up front instead.
  const { files: platformFiles, ref } = await gitFiles(PLATFORM)
  if (!platformFiles.length) {
    console.error('could not list platform files — is the repo initialised?')
    process.exit(2)
  }
  const byBasename = new Set(platformFiles.map(f => path.basename(f)))
  const allPaths = new Set(platformFiles)
  // Citations are frequently written relative to a subdirectory
  // ("api/app/routers/admin.py" for "packages/api/app/routers/admin.py"), so
  // index every path suffix. Without this the checker reports renames that
  // never happened and the signal drowns in noise.
  const bySuffix = new Set<string>()
  for (const f of platformFiles) {
    const parts = f.split('/')
    for (let i = 0; i < parts.length; i++) bySuffix.add(parts.slice(i).join('/'))
  }

  const files = await walk(PATHS.operationsRoot)
  const dead: Dead[] = []
  let checked = 0, filesWithCitations = 0

  for (const file of files) {
    const rel = path.relative(PATHS.operationsRoot, file)
    const text = await fs.readFile(file, 'utf-8')
    const citations = new Set<string>()
    for (const m of text.matchAll(CITATION)) citations.add(m[1])
    if (!citations.size) continue
    filesWithCitations++

    const bidFacing = BID_FACING.some(re => re.test(rel))
    for (const c of citations) {
      checked++
      if (allPaths.has(c) || bySuffix.has(c)) continue
      // Bare filenames (deploy.yml) are ambiguous — accept them if the basename
      // exists anywhere, so a moved-but-present file is not a false alarm.
      if (!c.includes('/') && byBasename.has(c)) continue
      dead.push({ file: rel, citation: c, bidFacing })
    }
  }

  const byFile = new Map<string, Dead[]>()
  for (const d of dead) {
    if (!byFile.has(d.file)) byFile.set(d.file, [])
    byFile.get(d.file)!.push(d)
  }

  console.log(`verified against platform ref: ${ref}`)
  console.log(`citations checked: ${checked} across ${filesWithCitations} files`)
  console.log(`resolved: ${checked - dead.length}   DEAD: ${dead.length}\n`)

  const bidFacingDead = dead.filter(d => d.bidFacing)
  for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const flag = items[0].bidFacing ? '  ⚠ BID-FACING' : ''
    console.log(`${file}  (${items.length} dead)${flag}`)
    for (const i of items) console.log(`    ✗ ${i.citation}`)
  }

  if (bidFacingDead.length) {
    console.log(`\n${bidFacingDead.length} dead citation(s) in BID-FACING material.`)
    console.log('Each is either a rename to chase or a capability that went away.')
    console.log('Resolve before submitting anything that draws on these files.')
  } else if (dead.length === 0) {
    console.log('Every citation resolves.')
  }

  if (GATE && bidFacingDead.length) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })
