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
    // Outcome numbers come from a text field, so guard the shape here rather
    // than letting NaN reach the frontmatter and read back as a real value.
    for (const k of ['impressions', 'engagementRate'] as const) {
      const v = body[k]
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 })
      }
    }
    if (body.publishedUrl !== undefined) {
      if (typeof body.publishedUrl !== 'string') {
        return NextResponse.json({ error: 'publishedUrl must be a string' }, { status: 400 })
      }
      if (body.publishedUrl && !/^https?:\/\//i.test(body.publishedUrl)) {
        return NextResponse.json({ error: 'publishedUrl must start with http:// or https://' }, { status: 400 })
      }
    }

    const updated = await decideSuggestion(params.id, {
      status: body.status,
      feedback: body.feedback,
      draft: typeof body.draft === 'string' ? body.draft : undefined,
      publishedUrl: body.publishedUrl,
      publishedAt: typeof body.publishedAt === 'string' ? body.publishedAt : undefined,
      impressions: body.impressions,
      engagementRate: body.engagementRate,
    })
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    console.error(`PATCH /api/content/${params.id} error:`, error)
    return NextResponse.json({ error: 'Failed to update suggestion' }, { status: 500 })
  }
}
