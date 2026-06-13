import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { listBids, writeBidStatus } from '@/lib/files'
import { PATHS } from '@/lib/paths'
import { buildAgentMessage, filesFromForm, saveFiles, slugifyBidName, triggerAgent } from '@/lib/intake'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const bids = await listBids()
    return NextResponse.json(bids)
  } catch (error) {
    console.error('GET /api/bids error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const rawName = form.get('name')
    const slug = typeof rawName === 'string' ? slugifyBidName(rawName) : null
    if (!slug) {
      return NextResponse.json({ error: 'Invalid bid name' }, { status: 400 })
    }

    const bidDir = path.join(PATHS.bids, slug)
    const already = await fs.access(bidDir).then(() => true).catch(() => false)
    if (already) {
      return NextResponse.json(
        { error: `Bid "${slug}" already exists — open it and upload there` },
        { status: 409 }
      )
    }

    const { files, error, status } = filesFromForm(form)
    if (error) return NextResponse.json({ error }, { status })

    const dest = path.join(bidDir, 'documents')
    const saved = await saveFiles(dest, files)
    await writeBidStatus(slug, { status: 'Analyzing' })

    const note = form.get('note')
    triggerAgent(
      buildAgentMessage(
        `New bid "${slug}" created from uploaded RFP documents — run the full bid analysis.`,
        saved,
        typeof note === 'string' ? note : undefined
      )
    )

    return NextResponse.json({ bidName: slug, saved: saved.map(p => path.basename(p)), dest })
  } catch (error) {
    console.error('POST /api/bids error:', error)
    return NextResponse.json({ error: 'Failed to create bid' }, { status: 500 })
  }
}
