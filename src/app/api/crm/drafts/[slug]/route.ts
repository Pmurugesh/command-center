import { NextResponse } from 'next/server'
import { readDraft, writeDraft } from '@/lib/followup'
import { appendLog } from '@/lib/crm'

export const dynamic = 'force-dynamic'

/** Save edited subject + body. Sets edited=true so it is never auto-regenerated. */
export async function PUT(
  request: Request,
  { params }: { params: { slug: string } }
) {
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
 * PATCH actions:
 *   { action: 'mark-sent' } — flip status=sent, auto-log to CRM contact
 */
export async function PATCH(
  request: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const body = await request.json()

    if (body.action === 'mark-sent') {
      const existing = await readDraft(params.slug)
      if (!existing) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
      }

      const updated = await writeDraft({
        ...existing,
        status: 'sent',
        sentAt: new Date().toISOString(),
      })

      // Log the send to the CRM contact — best effort.
      // The contact may not exist for all draft types; that is fine.
      try {
        await appendLog(
          params.slug,
          `Sent follow-up email: ${existing.subject}`,
          { via: 'outreach' }
        )
      } catch {
        /* Non-fatal: the draft is marked sent regardless. */
      }

      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  } catch (error) {
    console.error(`PATCH /api/crm/drafts/${params.slug} error:`, error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
