import { NextResponse } from 'next/server'
import { resolveStrategicDecision } from '@/lib/gtm'

export const dynamic = 'force-dynamic'

// Appends [RESOLVED YYYY-MM-DD] to a decision line in a gtm/intelligence
// markdown file. The lib enforces the path allowlist (no traversal, scanned
// dirs only); a refused resolve is a 404 rather than an error — the line may
// already carry the marker from a hand edit.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (typeof body?.file !== 'string' || typeof body?.lineNumber !== 'number') {
      return NextResponse.json({ error: 'file and lineNumber are required' }, { status: 400 })
    }
    const ok = await resolveStrategicDecision(body.file, body.lineNumber)
    if (!ok) return NextResponse.json({ error: 'not resolvable' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/gtm/resolve error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
