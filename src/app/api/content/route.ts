import { NextResponse } from 'next/server'
import { listSuggestions, createSuggestion } from '@/lib/content'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await listSuggestions())
}

/** Create a suggestion outside the Monday run — an event, a timely thought. */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const entity = typeof body.entity === 'string' ? body.entity.trim() : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''

    if (!entity || !topic) {
      return NextResponse.json({ error: 'entity and topic are required' }, { status: 400 })
    }

    const created = await createSuggestion({
      entity,
      topic,
      hook: typeof body.hook === 'string' ? body.hook : undefined,
      angle: typeof body.angle === 'string' ? body.angle : undefined,
      day: typeof body.day === 'string' ? body.day : undefined,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('POST /api/content error:', error)
    return NextResponse.json({ error: 'Failed to create suggestion' }, { status: 500 })
  }
}
