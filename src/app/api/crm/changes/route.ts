import { NextResponse } from 'next/server'
import { getChanges } from '@/lib/insights'

export const dynamic = 'force-dynamic'

// `since` is supplied by the client from localStorage — the last time THIS
// browser saw the page. Server-side there is no notion of "your last visit".
export async function GET(request: Request) {
  try {
    const since = new URL(request.url).searchParams.get('since')
    if (!since || Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: 'since must be an ISO timestamp' }, { status: 400 })
    }
    return NextResponse.json(await getChanges(since))
  } catch (error) {
    console.error('GET /api/crm/changes error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
