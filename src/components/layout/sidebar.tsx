"use client"

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_SECTIONS } from '@/lib/config'
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeft } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    NAV_SECTIONS.forEach(s => { initial[s.label] = !s.collapsedByDefault })
    return initial
  })

  const toggleSection = (label: string) => {
    setExpandedSections(prev => ({ ...prev, [label]: !prev[label] }))
  }

  if (collapsed) {
    return (
      <aside className="w-14 border-r border-border bg-card flex flex-col items-center py-4 transition-all">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <nav className="flex-1 flex flex-col items-center gap-1">
          {NAV_SECTIONS.flatMap(section =>
            section.items.map(item => {
              const isActive = item.href === '/'
                ? pathname === '/'
                : item.href === '/system'
                  ? pathname === '/system'
                  : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "p-2 rounded-md transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                  title={item.label}
                >
                  <item.icon className="h-4 w-4" />
                </Link>
              )
            })
          )}
        </nav>
      </aside>
    )
  }

  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col transition-all">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
          <p className="text-xs text-muted-foreground">OpenClaw Dashboard</p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1.5 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex-1 p-2 overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-1">
            <button
              onClick={() => toggleSection(section.label)}
              className="flex items-center gap-1 w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              {expandedSections[section.label] ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {section.label}
            </button>
            {expandedSections[section.label] && (
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href === '/'
                    ? pathname === '/'
                    : item.href === '/system'
                      ? pathname === '/system'
                      : pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-border text-xs text-muted-foreground">
        Local Dashboard
      </div>
    </aside>
  )
}
