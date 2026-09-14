import { NextResponse } from 'next/server'
import { getBidDetail } from '@/lib/files'
import { safeSlug } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { bidName: string } }
) {
  if (!safeSlug(params.bidName)) {
    return NextResponse.json({ error: 'Invalid bid name' }, { status: 400 })
  }
  try {
    const detail = await getBidDetail(params.bidName)
    if (!detail) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (error) {
    console.error(`GET /api/bids/${params.bidName} error:`, error)
    return NextResponse.json({ error: 'Failed to fetch bid detail' }, { status: 500 })
  }
}
