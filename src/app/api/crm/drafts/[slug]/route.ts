import { NextResponse } from 'next/server'
import { parseDraftPatch, readDraft, writeDraft } from '@/lib/followup'
import { addDays, appendLog, updateContact } from '@/lib/crm'
import { localToday } from '@/lib/dates'
import { FOLLOWUP_WINDOW_DAYS, SENT_NEXT_ACTION } from '@/lib/scribe-rules'
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
 *   { action: 'mark-sent' }   — flip status=sent, log the send on the CRM
 *                               contact and open the follow-up window: next
 *                               action "await reply", due in 10 days. (Robert
 *                               Payne's Sep 1 send left next_action_due at
 *                               2026-07-29, so the board kept him overdue.)
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

      const updated = await writeDraft({
        ...existing,
        status: 'sent',
        sentAt: new Date().toISOString(),
      })

      // Log the send to the CRM contact — best effort.
      // The contact may not exist for all draft types; that is fine.
      try {
        const sent = localToday()
        await appendLog(
          params.slug,
          `Sent follow-up email: ${existing.subject}`,
          { via: 'outreach', date: sent }
        )
        await updateContact(
          params.slug,
          { nextAction: SENT_NEXT_ACTION, nextActionDue: addDays(sent, FOLLOWUP_WINDOW_DAYS) },
          'outreach'
        )
      } catch {
        /* Non-fatal: the draft is marked sent regardless. */
      }

      return NextResponse.json(updated)
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
