import { NextResponse } from 'next/server'
import { listLibraryFiles } from '@/lib/files'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const files = await listLibraryFiles()
    return NextResponse.json(files)
  } catch (error) {
    console.error('GET /api/library error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
