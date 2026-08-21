import { NextResponse } from 'next/server'
import { appendLog } from '@/lib/crm'

export const dynamic = 'force-dynamic'

// The highest-frequency write in the system: "I talked to them." Bumps
// last_touched and advances stage off `identified` as a side effect, so the
// caller never has to remember the bookkeeping.
export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
    const body = await request.json()
    if (!body?.text || typeof body.text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    const updated = await appendLog(params.slug, body.text, {
      via: typeof body.via === 'string' ? body.via : 'dashboard',
      date: typeof body.date === 'string' ? body.date : undefined,
      clearNextAction: body.clearNextAction === true,
    })
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('POST /api/crm/contacts/[slug]/log error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
