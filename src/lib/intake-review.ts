/**
 * Email intake review queue — the "uncertain" lane of the Scribe design.
 *
 * The deterministic filer (scripts/scribe.ts) handles what an exact email match
 * proves; everything else lands here as a distilled row (sender, subject, date,
 * why it was staged — never the body) for a human to resolve on the dashboard:
 * create a contact, or dismiss. Rows are facts about correspondence, so the
 * queue lives in git like the rest of the store; raw messages stay in the
 * gitignored staging dir on the machine that runs the connector.
 *
 * Items are keyed by the staged file's stem (the connector's message hash), so
 * the filer can upsert idempotently: a dismissed or resolved row is never
 * resurrected by the next sweep.
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from './paths'
import { localDaysAgo, localToday } from './dates'
import { runCommandArgs } from './shell'
import { acquireLock, atomicWrite, fileExists } from './store'
import type { IntakeReviewItem, IntakeReviewStatus } from '@/types'

const QUEUE_PATH = path.join(PATHS.crmIntakeReview, 'email-queue.json')

async function readAll(): Promise<IntakeReviewItem[]> {
  if (!(await fileExists(QUEUE_PATH))) return []
  try {
    const parsed = JSON.parse(await fs.readFile(QUEUE_PATH, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeAll(items: IntakeReviewItem[], summary: string, via: string): Promise<void> {
  await atomicWrite(QUEUE_PATH, `${JSON.stringify(items, null, 2)}\n`)
  const rel = path.relative(PATHS.operationsRoot, QUEUE_PATH)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `intake: ${summary}`, '-m', `via: ${via}`,
      '--', rel,
    ], 15_000)
  } catch { /* nothing staged, or git unavailable — the janitor sweeps */ }
}

export async function listReviewItems(): Promise<IntakeReviewItem[]> {
  return readAll()
}

export async function listPending(): Promise<IntakeReviewItem[]> {
  return (await readAll()).filter(i => i.status === 'pending')
}

/**
 * Merge the filer's sweep into the queue. New addresses are added as pending;
 * a pending row absorbs further messages (count, latest subject/date); a
 * dismissed or resolved address is never resurrected — dismissing a vendor
 * means their next newsletter does not re-ask the question.
 */
export async function upsertPending(items: IntakeReviewItem[], via: string): Promise<number> {
  const release = await acquireLock(PATHS.crmIntakeReview)
  try {
    const current = await readAll()
    const byId = new Map(current.map(i => [i.id, i]))
    let added = 0
    let merged = 0
    for (const item of items) {
      const existing = byId.get(item.id)
      if (!existing) {
        byId.set(item.id, item)
        added++
      } else if (existing.status === 'stale') {
        // The old question expired; a new message is a new question.
        byId.set(item.id, { ...item, count: existing.count + item.count })
        added++
      } else if (existing.status === 'pending') {
        existing.count += item.count
        if (item.date >= existing.date) {
          existing.date = item.date
          existing.subject = item.subject
          existing.from = item.from
          existing.fromName = item.fromName ?? existing.fromName
          existing.direction = item.direction
        }
        merged++
      }
    }
    if (!added && !merged) return 0
    await writeAll(
      Array.from(byId.values()),
      `${added} correspondent(s) to review`,
      via,
    )
    return added
  } finally {
    await release()
  }
}

/**
 * A pending row nobody has resolved in `days` is not a decision waiting to be
 * made, it is a question that expired: the 8am brief was counting a 12-message
 * vendor thread from July as "awaiting a human". Marked `stale` — never
 * deleted, so the queue still shows what came in — and a fresh message from
 * the same address re-opens it as a new pending row (see upsertPending).
 * Returns how many rows changed.
 */
export async function expireStale(days: number, via: string): Promise<number> {
  const release = await acquireLock(PATHS.crmIntakeReview)
  try {
    const current = await readAll()
    const cutoff = localDaysAgo(days)
    const today = localToday()
    let changed = 0
    for (const item of current) {
      if (item.status !== 'pending' || item.date >= cutoff) continue
      item.status = 'stale'
      item.resolvedAt = today
      changed++
    }
    if (changed) await writeAll(current, `${changed} row(s) stale after ${days} days`, via)
    return changed
  } finally {
    await release()
  }
}

export async function setReviewStatus(
  id: string, status: IntakeReviewStatus, via: string,
): Promise<IntakeReviewItem | null> {
  const release = await acquireLock(PATHS.crmIntakeReview)
  try {
    const current = await readAll()
    const item = current.find(i => i.id === id)
    if (!item) return null
    item.status = status
    item.resolvedAt = localToday()
    await writeAll(current, `${status}: ${item.from}`, via)
    return item
  } finally {
    await release()
  }
}
