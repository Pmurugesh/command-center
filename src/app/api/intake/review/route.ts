import { NextResponse } from 'next/server'
import { listPending, setReviewStatus } from '@/lib/intake-review'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await listPending())
  } catch (error) {
    console.error('GET /api/intake/review error:', error)
    return NextResponse.json({ error: 'failed to read review queue' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, status } = body ?? {}
    if (typeof id !== 'string' || !['dismissed', 'contact-created'].includes(status)) {
      return NextResponse.json({ error: 'id and status (dismissed | contact-created) required' }, { status: 400 })
    }
    const via = typeof body.via === 'string' ? body.via : 'dashboard'
    const item = await setReviewStatus(id, status, via)
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(item)
  } catch (error) {
    console.error('PATCH /api/intake/review error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
