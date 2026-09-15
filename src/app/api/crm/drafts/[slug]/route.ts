import { NextResponse } from 'next/server'
import { markDraftSent, parseDraftPatch, readDraft, writeDraft } from '@/lib/followup'
import { safeSlug } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** Save edited subject + body. Sets edited=true so it is never auto-regenerated. */
export async function PUT(
  request: Request,
  { params }: { params: { slug: string } }
) {
  if (!safeSlug(params.slug)) {
    return NextResponse.json({ error: 'Invalid draft slug' }, { status: 400 })
  }
  try {
    const body = await request.json()
    if (typeof body.subject !== 'string' || typeof body.body !== 'string') {
      return NextResponse.json(
        { error: 'subject and body are required strings' },
        { status: 400 }
      )
    }
    const existing = await readDraft(params.slug)
    if (!existing) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    const updated = await writeDraft({
      ...existing,
      subject: body.subject,
      body: body.body,
      edited: true,
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error(`PUT /api/crm/drafts/${params.slug} error:`, error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

/**
 * PATCH:
 *   { action: 'mark-sent' }   — Pavan sent it from his own mail client: flip
 *                               status=sent, log the send on the CRM contact
 *                               and open the follow-up window (markDraftSent).
 *                               A send BY the dashboard is POST …/send.
 *   { ready?, checks?, why_now? } — persist draft metadata; unknown keys are
 *                               ignored, wrong types are 400. `edited` is
 *                               untouched: these say the draft was REVIEWED,
 *                               not that its text changed.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { slug: string } }
) {
  if (!safeSlug(params.slug)) {
    return NextResponse.json({ error: 'Invalid draft slug' }, { status: 400 })
  }
  try {
    const body = await request.json()

    if (body?.action === 'mark-sent') {
      const existing = await readDraft(params.slug)
      if (!existing) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
      }

      return NextResponse.json(await markDraftSent(existing))
    }

    if (body?.action !== undefined) {
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
    }

    const parsed = parseDraftPatch(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const existing = await readDraft(params.slug)
    if (!existing) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    return NextResponse.json(await writeDraft({ ...existing, ...parsed.patch }))
  } catch (error) {
    console.error(`PATCH /api/crm/drafts/${params.slug} error:`, error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
