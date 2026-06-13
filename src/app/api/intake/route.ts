import { NextResponse } from 'next/server'
import path from 'path'
import { PATHS } from '@/lib/paths'
import { buildAgentMessage, filesFromForm, saveFiles, triggerAgent } from '@/lib/intake'

export const dynamic = 'force-dynamic'

// Allowlist keyed by form value — no user-supplied paths ever touch the filesystem.
const DESTINATIONS: Record<string, { dir: string; label: string }> = {
  inbox: { dir: PATHS.inbox, label: 'inbox' },
  intelligence: { dir: PATHS.intelligenceBase, label: 'intelligence' },
  business: { dir: PATHS.businessContext, label: 'business context' },
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const rawDest = form.get('destination')
    const destKey = typeof rawDest === 'string' && rawDest ? rawDest : 'inbox'
    const dest = DESTINATIONS[destKey]
    if (!dest) {
      return NextResponse.json({ error: 'Invalid destination' }, { status: 400 })
    }

    const { files, error, status } = filesFromForm(form)
    if (error) return NextResponse.json({ error }, { status })

    const saved = await saveFiles(dest.dir, files)

    const note = form.get('note')
    const agent = form.get('agent')
    triggerAgent(
      buildAgentMessage(
        `General documents dropped into the ${dest.label} folder — file and process them appropriately.`,
        saved,
        typeof note === 'string' ? note : undefined
      ),
      typeof agent === 'string' ? agent : undefined
    )

    return NextResponse.json({ saved: saved.map(p => path.basename(p)), dest: dest.dir })
  } catch (error) {
    console.error('POST /api/intake error:', error)
    return NextResponse.json({ error: 'Failed to save files' }, { status: 500 })
  }
}
