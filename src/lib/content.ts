/**
 * Content loop data layer (Phase 9).
 *
 * Voice generates 3–5 grounded suggestions every Monday and used to announce
 * them to Telegram, where they evaporated — content-engine's drafts/ dirs are
 * empty and its calendar stopped being updated in July because nothing ever
 * wrote back. This module is the missing half: one file per suggestion, your
 * pick/skip/feedback written back to the same file, so `git log` over the
 * directory IS the decision history (same contract as crm.ts).
 *
 * The full draft is deliberately NOT generated up front — Voice writes a hook
 * and an angle, which is enough to choose between, and only a picked post gets
 * drafted. Four discarded drafts a week is the cost we're avoiding.
 */

import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import type { ContentSuggestion, ContentStatus } from '@/types'

/**
 * Voice reads this before generating each Monday. It is DERIVED state,
 * rewritten on every decision, so it can never drift from what you actually
 * picked — the alternative (Voice scanning a directory that grows forever)
 * costs more tokens every week and still has to be told what to look at.
 * Underscore-prefixed so it sorts away from the suggestions themselves.
 */
export const DIGEST_FILE = '_feedback-digest.md'

const VALID_STATUS: ContentStatus[] = ['suggested', 'picked', 'skipped', 'drafted']

export function isContentStatus(v: unknown): v is ContentStatus {
  return typeof v === 'string' && (VALID_STATUS as string[]).includes(v)
}

/** Reject anything that could escape the suggestions dir. Ids come from URLs. */
function safeId(id: string): string | null {
  if (!id || id.includes('/') || id.includes('..') || id.startsWith('.')) return null
  return id
}

function suggestionPath(id: string): string {
  return path.join(PATHS.contentSuggestions, `${id}.md`)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function parse(id: string, raw: string): ContentSuggestion {
  const { data, content } = matter(raw)

  // Body sections are written by us below, so a simple header split is enough.
  const section = (name: string): string => {
    const m = content.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'))
    return m ? m[1].trim() : ''
  }

  const statusRaw = data.status
  return {
    id,
    week: str(data.week),
    postNumber: typeof data.post_number === 'number' ? data.post_number : 0,
    entity: str(data.entity),
    day: str(data.day),
    topic: str(data.topic),
    signalSource: str(data.signal_source),
    strategicValue: str(data.strategic_value),
    hook: section('Hook'),
    angle: section('Draft angle'),
    draft: section('Draft') || undefined,
    status: isContentStatus(statusRaw) ? statusRaw : 'suggested',
    optional: data.optional === true,
    feedback: str(data.feedback) || undefined,
    decidedAt: str(data.decided_at) || undefined,
    generatedAt: str(data.generated_at) || undefined,
  }
}

export function serialize(s: ContentSuggestion): string {
  // Only defined values reach the frontmatter, so absent fields stay absent.
  const fm: Record<string, unknown> = {
    week: s.week,
    post_number: s.postNumber,
    entity: s.entity,
    day: s.day,
    topic: s.topic,
    signal_source: s.signalSource,
    strategic_value: s.strategicValue,
    status: s.status,
    optional: s.optional || undefined,
    feedback: s.feedback || undefined,
    decided_at: s.decidedAt || undefined,
    generated_at: s.generatedAt || undefined,
  }
  for (const k of Object.keys(fm)) if (fm[k] === undefined) delete fm[k]

  const body = [
    `## Hook\n\n${s.hook}`,
    `## Draft angle\n\n${s.angle}`,
    s.draft ? `## Draft\n\n${s.draft}` : '',
  ].filter(Boolean).join('\n\n')

  return matter.stringify(`\n${body}\n`, fm)
}

export async function listSuggestions(): Promise<ContentSuggestion[]> {
  let files: string[]
  try {
    files = await fs.readdir(PATHS.contentSuggestions)
  } catch {
    return []   // directory not created yet — a legitimate empty state
  }

  const out: ContentSuggestion[] = []
  for (const f of files) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue
    try {
      const raw = await fs.readFile(path.join(PATHS.contentSuggestions, f), 'utf-8')
      out.push(parse(f.replace(/\.md$/, ''), raw))
    } catch { /* skip unreadable */ }
  }

  // Newest week first, then Voice's own ordering within the week.
  return out.sort((a, b) =>
    b.week.localeCompare(a.week) || a.postNumber - b.postNumber
  )
}

export async function getSuggestion(id: string): Promise<ContentSuggestion | null> {
  const safe = safeId(id)
  if (!safe) return null
  try {
    return parse(safe, await fs.readFile(suggestionPath(safe), 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Commit one suggestion. Deliberately does NOT push — the janitor sweeps every
 * 120s, so a UI write never waits on the network. Failures are swallowed for
 * the same reason as crm.ts: losing one history entry beats refusing the edit.
 */
async function commitSuggestion(id: string, summary: string): Promise<void> {
  // The refreshed digest rides along in the same commit as the decision that
  // caused it, so history never shows one without the other.
  const paths = [
    path.relative(PATHS.operationsRoot, suggestionPath(id)),
    path.relative(PATHS.operationsRoot, path.join(PATHS.content, DIGEST_FILE)),
  ]
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', ...paths], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `content: ${summary}`,
      '-m', `suggestion: ${id}\nvia: dashboard`,
      '--', ...paths,
    ], 15_000)
  } catch { /* nothing staged, or git unavailable — janitor sweeps */ }
}

export async function writeSuggestion(
  s: ContentSuggestion, summary: string, commit = true,
): Promise<ContentSuggestion> {
  await fs.mkdir(PATHS.contentSuggestions, { recursive: true })
  await fs.writeFile(suggestionPath(s.id), serialize(s), 'utf-8')
  // Rebuild BEFORE committing so the decision and its digest land together.
  await refreshDigest()
  if (commit) await commitSuggestion(s.id, summary)
  return s
}

/** Apply a decision (pick/skip) and/or feedback to one suggestion. */
export async function decideSuggestion(
  id: string,
  patch: { status?: ContentStatus; feedback?: string; draft?: string },
): Promise<ContentSuggestion | null> {
  const current = await getSuggestion(id)
  if (!current) return null

  const next: ContentSuggestion = {
    ...current,
    status: patch.status ?? current.status,
    feedback: patch.feedback ?? current.feedback,
    draft: patch.draft ?? current.draft,
  }
  // Stamp only when the decision itself changed, so editing feedback later
  // doesn't rewrite when you made the call.
  if (patch.status && patch.status !== current.status) {
    next.decidedAt = new Date().toISOString()
  }

  const what = patch.status && patch.status !== current.status
    ? `${patch.status} — ${current.entity}: ${current.topic}`
    : `feedback on ${current.entity}: ${current.topic}`
  return writeSuggestion(next, what)
}

// ── feedback digest ─────────────────────────────────────────────────────────

/** How many weeks of history Voice is shown. Enough to see a pattern, short
 *  enough that a bad call six months ago stops steering this week's ideas. */
const DIGEST_WEEKS = 6

export function buildDigest(all: ContentSuggestion[]): string {
  const weeks = Array.from(new Set(all.map(s => s.week))).sort().reverse().slice(0, DIGEST_WEEKS)
  const recent = all.filter(s => weeks.includes(s.week))

  const picked = recent.filter(s => s.status === 'picked' || s.status === 'drafted')
  const skipped = recent.filter(s => s.status === 'skipped')
  const undecided = recent.filter(s => s.status === 'suggested')
  const withNotes = recent.filter(s => s.feedback)

  // Per-entity hit rate: the single most useful number, because it says where
  // effort is landing without anyone having to write it down.
  const entities = Array.from(new Set(recent.map(s => s.entity))).sort()
  const rates = entities.map(e => {
    const mine = recent.filter(s => s.entity === e)
    const p = mine.filter(s => s.status === 'picked' || s.status === 'drafted').length
    const k = mine.filter(s => s.status === 'skipped').length
    return { entity: e, picked: p, skipped: k, total: mine.length }
  })

  const L: string[] = []
  L.push('# Content feedback digest')
  L.push('')
  L.push('Generated by the dashboard on every pick/skip/feedback — do not edit by hand.')
  L.push(`Covers the last ${weeks.length} week(s) of suggestions.`)
  L.push('')
  L.push(`**Totals:** ${picked.length} picked · ${skipped.length} skipped · ${undecided.length} undecided`)
  L.push('')

  L.push('## Hit rate by entity')
  L.push('')
  if (rates.length === 0) {
    L.push('_No decisions recorded yet._')
  } else {
    L.push('| Entity | Picked | Skipped | Suggested |')
    L.push('| --- | --- | --- | --- |')
    for (const r of rates) L.push(`| ${r.entity} | ${r.picked} | ${r.skipped} | ${r.total} |`)
  }
  L.push('')

  L.push('## Picked — do more like this')
  L.push('')
  if (picked.length === 0) L.push('_Nothing picked yet._')
  for (const s of picked) {
    L.push(`- **${s.entity}** (${s.week}) — ${s.topic}`)
    if (s.feedback) L.push(`  - note: ${s.feedback}`)
  }
  L.push('')

  L.push('## Skipped — do not repeat these angles')
  L.push('')
  if (skipped.length === 0) L.push('_Nothing skipped yet._')
  for (const s of skipped) {
    L.push(`- **${s.entity}** (${s.week}) — ${s.topic}`)
    if (s.feedback) L.push(`  - reason: ${s.feedback}`)
  }
  L.push('')

  L.push("## Pavan's notes verbatim")
  L.push('')
  L.push('Treat these as the strongest signal in this file — they are the only')
  L.push('part written by a human rather than derived from a click.')
  L.push('')
  if (withNotes.length === 0) {
    L.push('_No notes yet._')
  } else {
    for (const s of withNotes) {
      L.push(`- **${s.entity}** — ${s.topic} → _${s.status}_`)
      L.push(`  > ${s.feedback}`)
    }
  }
  L.push('')

  L.push('## Still undecided')
  L.push('')
  L.push('Do not re-suggest these; they are already in front of him.')
  L.push('')
  if (undecided.length === 0) L.push('_None._')
  for (const s of undecided) L.push(`- **${s.entity}** (${s.week}) — ${s.topic}`)
  L.push('')

  return L.join('\n')
}

/** Rebuild the digest from whatever is currently on disk. */
export async function refreshDigest(): Promise<string> {
  const all = await listSuggestions()
  const body = buildDigest(all)
  await fs.mkdir(PATHS.content, { recursive: true })
  await fs.writeFile(path.join(PATHS.content, DIGEST_FILE), body, 'utf-8')
  return body
}

/** Group by week for rendering, newest week first. */
export function byWeek(all: ContentSuggestion[]): { week: string; items: ContentSuggestion[] }[] {
  const map = new Map<string, ContentSuggestion[]>()
  for (const s of all) {
    if (!map.has(s.week)) map.set(s.week, [])
    map.get(s.week)!.push(s)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, items]) => ({ week, items }))
}
