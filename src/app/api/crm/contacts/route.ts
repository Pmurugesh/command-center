import { NextResponse } from 'next/server'
import { listContacts, createContact, bucketize } from '@/lib/crm'

export const dynamic = 'force-dynamic'

// ?view=buckets returns the Today-page shape (overdue/blocked/due/cold) so the
// bucketing rule lives in one place and the client never re-derives urgency.
export async function GET(request: Request) {
  try {
    const view = new URL(request.url).searchParams.get('view')
    const contacts = await listContacts()
    return NextResponse.json(view === 'buckets' ? bucketize(contacts) : contacts)
  } catch (error) {
    console.error('GET /api/crm/contacts error:', error)
    return NextResponse.json({ error: 'failed to read contacts' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body?.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const contact = await createContact(body, typeof body.via === 'string' ? body.via : 'dashboard')
    return NextResponse.json(contact, { status: 201 })
  } catch (error) {
    console.error('POST /api/crm/contacts error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
