import { NextResponse } from 'next/server'
import { listBids } from '@/lib/files'

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
