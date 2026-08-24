"use client"

/**
 * The section/link list shared by the desktop sidebar and the mobile drawer —
 * one source for the nav so the two can never drift.
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_SECTIONS } from '@/lib/config'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function isActiveHref(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  if (href === '/system') return pathname === '/system'
  return pathname.startsWith(href)
}

export function NavList({ rowClass = 'py-2', onNavigate }: {
  rowClass?: string // drawer rows go taller (py-3 ≈ 44px targets)
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    NAV_SECTIONS.forEach(s => { initial[s.label] = !s.collapsedByDefault })
    return initial
  })

  const toggleSection = (label: string) => {
    setExpandedSections(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="mb-1">
          <button
            onClick={() => toggleSection(section.label)}
            className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
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
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 text-sm transition-colors',
                    rowClass,
                    isActiveHref(pathname, item.href)
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}
