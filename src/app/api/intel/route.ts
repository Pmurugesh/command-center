import { NextResponse } from 'next/server'
import { listIntelAlerts } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const alerts = await listIntelAlerts()
    return NextResponse.json(alerts)
  } catch (error) {
    console.error('GET /api/intel error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
