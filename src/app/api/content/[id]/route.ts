import { NextResponse } from 'next/server'
import { getSuggestion, decideSuggestion, isContentStatus } from '@/lib/content'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const s = await getSuggestion(params.id)
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(s)
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()

    // Validate before touching disk: an unknown status would otherwise be
    // written straight into frontmatter and read back as 'suggested' forever.
    if (body.status !== undefined && !isContentStatus(body.status)) {
      return NextResponse.json(
        { error: 'status must be suggested | picked | skipped | drafted' },
        { status: 400 }
      )
    }
    if (body.feedback !== undefined && typeof body.feedback !== 'string') {
      return NextResponse.json({ error: 'feedback must be a string' }, { status: 400 })
    }

    const updated = await decideSuggestion(params.id, {
      status: body.status,
      feedback: body.feedback,
      draft: typeof body.draft === 'string' ? body.draft : undefined,
    })
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    console.error(`PATCH /api/content/${params.id} error:`, error)
    return NextResponse.json({ error: 'Failed to update suggestion' }, { status: 500 })
  }
}
