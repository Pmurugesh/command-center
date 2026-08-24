"use client"

/**
 * Phone navigation: a hamburger in the top bar opening an overlay drawer.
 * The desktop sidebar is hidden under md:; this is the only nav on a phone
 * (the dashboard is reached over Tailscale from one, daily). Rows are py-3 for
 * ≥44px touch targets; closes on backdrop tap, the X, or any navigation.
 */
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { NavList } from './nav-list'

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close when the route changes — covers Links that bypass onNavigate.
  useEffect(() => { setOpen(false) }, [pathname])

  // Freeze the page behind the drawer.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
                <p className="text-xs text-muted-foreground">OpenClaw Dashboard</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              <NavList rowClass="py-3" onNavigate={() => setOpen(false)} />
            </nav>
          </aside>
        </div>
      )}
    </div>
  )
}
