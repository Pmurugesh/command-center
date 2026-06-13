import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { writeBidStatus } from '@/lib/files'
import { PATHS } from '@/lib/paths'
import { buildAgentMessage, filesFromForm, saveFiles, triggerAgent } from '@/lib/intake'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { bidName: string } }) {
  try {
    const bidName = params.bidName
    if (!bidName || bidName.includes('..') || bidName.includes('/') || bidName.startsWith('.')) {
      return NextResponse.json({ error: 'Invalid bid name' }, { status: 400 })
    }

    const bidDir = path.join(PATHS.bids, bidName)
    const exists = await fs.access(bidDir).then(() => true).catch(() => false)
    if (!exists) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }

    const form = await request.formData()
    const { files, error, status } = filesFromForm(form)
    if (error) return NextResponse.json({ error }, { status })

    const dest = path.join(bidDir, 'documents')
    const saved = await saveFiles(dest, files)
    // Bumps updatedAt so the bid re-sorts to the top of the pipeline
    await writeBidStatus(bidName, {})

    const note = form.get('note')
    triggerAgent(
      buildAgentMessage(
        `New documents added to existing bid "${bidName}" — review them against the current analysis.`,
        saved,
        typeof note === 'string' ? note : undefined
      )
    )

    return NextResponse.json({ saved: saved.map(p => path.basename(p)), dest })
  } catch (error) {
    console.error(`POST /api/bids/${params.bidName}/documents error:`, error)
    return NextResponse.json({ error: 'Failed to upload documents' }, { status: 500 })
  }
}
