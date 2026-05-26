import { NextResponse } from 'next/server'
import { getPartnerships } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const partnerships = await getPartnerships()
    return NextResponse.json(partnerships)
  } catch (error) {
    console.error('GET /api/partnerships error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
