import { NextResponse } from 'next/server'
import { listRoadmap, readStatus } from '@/lib/roadmap'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [items, status] = await Promise.all([listRoadmap(), readStatus()])
  return NextResponse.json({
    // Freshness travels with the data: a consumer that reads `items` without
    // knowing the check last ran three weeks ago is reading fiction.
    generatedAt: status.generatedAt ?? null,
    ran: status.ran,
    stale: status.stale,
    items,
  })
}
