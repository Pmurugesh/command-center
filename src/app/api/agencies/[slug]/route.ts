import { NextResponse } from 'next/server'
import { getAgency } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const agency = await getAgency(params.slug)
    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }
    return NextResponse.json(agency)
  } catch (error) {
    console.error(`GET /api/agencies/${params.slug} error:`, error)
    return NextResponse.json({ error: 'Failed to fetch agency' }, { status: 500 })
  }
}
