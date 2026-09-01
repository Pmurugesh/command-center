import { NextResponse } from 'next/server'
import { listDrafts } from '@/lib/followup'

export const dynamic = 'force-dynamic'

/** Return the full outreach queue — open first (priority-sorted), sent after. */
export async function GET() {
  try {
    const drafts = await listDrafts()
    return NextResponse.json(drafts)
  } catch (error) {
    console.error('GET /api/crm/drafts error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
