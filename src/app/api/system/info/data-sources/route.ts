import { NextResponse } from 'next/server'
import { getDataSources } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sources = await getDataSources()
    return NextResponse.json(sources)
  } catch (error) {
    console.error('GET /api/system/info/data-sources error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
