import { NextResponse, type NextRequest } from 'next/server'
import { crossSiteVerdict } from '@/lib/request-guard'

export function middleware(request: NextRequest) {
  const verdict = crossSiteVerdict(request.method, request.headers)
  if (verdict.allow) return NextResponse.next()
  return NextResponse.json(
    { error: 'Cross-site request refused', reason: verdict.reason },
    { status: 403 },
  )
}

// Only the API mutates state; pages are read-only renders.
export const config = { matcher: '/api/:path*' }
