import { NextResponse } from 'next/server'
import { sendDraft } from '@/lib/send-mail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/crm/drafts/[slug]/send  { "confirm": "<slug>", "via"?: "dashboard" | "pavan-telegram" }
 *
 * The dashboard sends a verified draft on Pavan's explicit per-draft yes
 * (wave 3, decision 1). Everything that must hold, and every refusal, lives in
 * lib/send-mail.ts; this file only speaks HTTP. There is deliberately no GET:
 * a link cannot send mail, only a POST that repeats the slug can.
 *
 * Cross-site browser requests never reach here — src/middleware.ts refuses
 * them for every mutating method under /api.
 */
export async function POST(
  request: Request,
  { params }: { params: { slug: string } },
) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON: { "confirm": "<slug>" }' }, { status: 400 })
  }
  try {
    const out = await sendDraft(params.slug, body)
    return NextResponse.json(out.body, { status: out.status })
  } catch (error) {
    console.error(`POST /api/crm/drafts/${params.slug}/send error:`, error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
