/**
 * Meeting archive — crm/meetings/YYYY-MM-DD-slug.md.
 *
 * Files come from the Granola sync (backfilled 2026-08-24, then daily via the
 * granola-crm-sync task / OpenClaw — spec in operations agents/granola-sync).
 * Auto-discovered like every other data source: whatever is in the directory
 * renders, no manual wiring.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'

export const MEETING_CATEGORIES = ['agency', 'partnership', 'gtm', 'product', 'operations'] as const
export type MeetingCategory = typeof MEETING_CATEGORIES[number]

export interface MeetingRecord {
  slug: string // filename without .md
  title: string
  date: string // YYYY-MM-DD
  category: MeetingCategory | 'other'
  agency?: string
  contacts: string[] // contact slugs
  participants: string[]
  granolaId?: string
  content: string // markdown body
}

function toRecord(filename: string, raw: string): MeetingRecord | null {
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!dateMatch) return null
  const { data, content } = matter(raw)
  const category = MEETING_CATEGORIES.includes(data.category) ? data.category : 'other'
  return {
    slug: filename.replace(/\.md$/, ''),
    title: typeof data.title === 'string' ? data.title : filename,
    date: typeof data.date === 'string' ? data.date : dateMatch[1],
    category,
    agency: typeof data.agency === 'string' ? data.agency : undefined,
    contacts: Array.isArray(data.contacts) ? data.contacts.filter((c: unknown) => typeof c === 'string') : [],
    participants: Array.isArray(data.participants) ? data.participants.filter((p: unknown) => typeof p === 'string') : [],
    granolaId: typeof data.granola_id === 'string' ? data.granola_id : undefined,
    content,
  }
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(PATHS.crmMeetings)
  } catch {
    return []
  }
  const meetings: MeetingRecord[] = []
  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue
    try {
      const raw = await fs.readFile(path.join(PATHS.crmMeetings, filename), 'utf-8')
      const record = toRecord(filename, raw)
      if (record) meetings.push(record)
    } catch {
      // unreadable file — skip rather than break the page
    }
  }
  return meetings.sort((a, b) => b.date.localeCompare(a.date))
}

export async function getMeeting(slug: string): Promise<MeetingRecord | null> {
  // Slug comes from a URL — refuse anything that isn't a plain archive filename.
  if (!/^[\w.-]+$/.test(slug)) return null
  try {
    const raw = await fs.readFile(path.join(PATHS.crmMeetings, `${slug}.md`), 'utf-8')
    return toRecord(`${slug}.md`, raw)
  } catch {
    return null
  }
}
