import { NextResponse } from 'next/server'
import { getContact } from '@/lib/crm'
import { getOrBuildDraft, writeDraft } from '@/lib/followup'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const contact = await getContact(params.slug)
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  return NextResponse.json(await getOrBuildDraft(contact, contact.log))
}

/** Save an edited draft. Marks it `edited` so it is never regenerated over. */
export async function PUT(
  request: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const body = await request.json()
    if (typeof body.subject !== 'string' || typeof body.body !== 'string') {
      return NextResponse.json({ error: 'subject and body are required strings' }, { status: 400 })
    }
    const contact = await getContact(params.slug)
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    return NextResponse.json(await writeDraft({
      slug: params.slug,
      subject: body.subject,
      body: body.body,
      edited: true,
    }))
  } catch (error) {
    console.error(`PUT /api/crm/contacts/${params.slug}/followup error:`, error)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }
}
