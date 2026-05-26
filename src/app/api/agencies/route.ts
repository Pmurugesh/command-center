import { NextResponse } from 'next/server'
import { listAgencies } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const agencies = await listAgencies()
    return NextResponse.json(agencies)
  } catch (error) {
    console.error('GET /api/agencies error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
