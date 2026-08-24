"use client"

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_SECTIONS } from '@/lib/config'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { NavList, isActiveHref } from './nav-list'

// Desktop-only (hidden under md:) — phones get the MobileNav drawer from the
// top bar instead of a permanent 224px bite out of a 390px screen.
export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <aside className="hidden w-14 flex-col items-center border-r border-border bg-card py-4 transition-all md:flex">
        <button
          onClick={() => setCollapsed(false)}
          className="mb-4 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV_SECTIONS.flatMap(section =>
            section.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  isActiveHref(pathname, item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
                title={item.label}
              >
                <item.icon className="h-4 w-4" />
              </Link>
            ))
          )}
        </nav>
      </aside>
    )
  }

  return (
    <aside className="hidden w-56 flex-col border-r border-border bg-card transition-all md:flex">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
          <p className="text-xs text-muted-foreground">OpenClaw Dashboard</p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <NavList />
      </nav>
      <div className="border-t border-border p-4 text-xs text-muted-foreground">
        Local Dashboard
      </div>
    </aside>
  )
}
