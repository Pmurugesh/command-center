import { NextResponse } from 'next/server'
import { listScripts } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const scripts = await listScripts()
    return NextResponse.json(scripts)
  } catch (error) {
    console.error('GET /api/system/info/scripts error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
