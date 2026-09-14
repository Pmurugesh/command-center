import { NextResponse } from 'next/server'
import { readBidStatus, writeBidStatus } from '@/lib/files'
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
    const status = await readBidStatus(params.bidName)
    if (!status) {
      return NextResponse.json({ status: 'Discovered', entity: 'Infinite Solutions', updatedAt: '' })
    }
    return NextResponse.json(status)
  } catch (error) {
    console.error(`GET /api/bids/${params.bidName}/status error:`, error)
    return NextResponse.json({ error: 'Failed to read status' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { bidName: string } }
) {
  if (!safeSlug(params.bidName)) {
    return NextResponse.json({ error: 'Invalid bid name' }, { status: 400 })
  }
  try {
    const body = await request.json()
    const updated = await writeBidStatus(params.bidName, body)
    return NextResponse.json(updated)
  } catch (error) {
    console.error(`PUT /api/bids/${params.bidName}/status error:`, error)
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
  }
}
