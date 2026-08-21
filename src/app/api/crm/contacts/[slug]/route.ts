import { NextResponse } from 'next/server'
import { getContact, updateContact, snoozeContact } from '@/lib/crm'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const contact = await getContact(params.slug)
  if (!contact) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(contact)
}

export async function PATCH(request: Request, { params }: { params: { slug: string } }) {
  try {
    const body = await request.json()
    const via = typeof body?.via === 'string' ? body.via : 'dashboard'

    // Snooze is a PATCH verb rather than its own route: it is just a computed
    // next_action_due, and keeping it here means one lock, one commit.
    if (typeof body?.snoozeDays === 'number') {
      const snoozed = await snoozeContact(params.slug, body.snoozeDays, via)
      if (!snoozed) return NextResponse.json({ error: 'not found' }, { status: 404 })
      return NextResponse.json(snoozed)
    }

    const { via: _via, snoozeDays: _s, ...patch } = body ?? {}
    const updated = await updateContact(params.slug, patch, via)
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('PATCH /api/crm/contacts/[slug] error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
