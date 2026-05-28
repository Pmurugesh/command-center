import { NextResponse } from 'next/server'
import { getAgents } from '@/lib/agents'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const agents = await getAgents()
    return NextResponse.json(agents)
  } catch (error) {
    console.error('GET /api/system/agents error:', error)
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 })
  }
}
