import { NextResponse } from 'next/server'
import { listScanReports } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const reports = await listScanReports()
    return NextResponse.json(reports)
  } catch (error) {
    console.error('GET /api/health error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
