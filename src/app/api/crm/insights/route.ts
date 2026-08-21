import { NextResponse } from 'next/server'
import { getInsights } from '@/lib/insights'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getInsights())
  } catch (error) {
    console.error('GET /api/crm/insights error:', error)
    return NextResponse.json({ error: 'failed to derive insights' }, { status: 500 })
  }
}
