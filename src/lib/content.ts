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
  const rel = path.relative(PATHS.operationsRoot, suggestionPath(id))
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `content: ${summary}`,
      '-m', `suggestion: ${id}\nvia: dashboard`,
      '--', rel,
    ], 15_000)
  } catch { /* nothing staged, or git unavailable — janitor sweeps */ }
}

export async function writeSuggestion(
  s: ContentSuggestion, summary: string, commit = true,
): Promise<ContentSuggestion> {
  await fs.mkdir(PATHS.contentSuggestions, { recursive: true })
  await fs.writeFile(suggestionPath(s.id), serialize(s), 'utf-8')
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
