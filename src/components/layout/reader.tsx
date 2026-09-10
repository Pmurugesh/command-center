"use client"

import { cn } from '@/lib/utils'

/**
 * Reader — the layout mode for browsing a set of documents.
 *
 * The problem it solves: /intel rendered 58 collapsed cards, 6,949px tall, with
 * ZERO expanded content on load — 6.7 screens of scrolling to reach 3,237
 * characters of text. /health, /gtm, /library and /channels all repeat the
 * pattern at smaller scale, and several cap the open document in a
 * `max-h-[600px]` nested scroller, so a long report has two scrollbars.
 *
 * Reader replaces the stack with an index rail and a pane that owns the full
 * page height. The index stays scannable, the document is always visible, and
 * nothing sits behind a click that a glance should answer.
 */
export function Reader({
  index,
  children,
  indexWidth = 'lg:w-[22rem] 3xl:w-[26rem]',
  className,
}: {
  /** The scannable list. Should carry a per-item signal, not just a filename. */
  index: React.ReactNode
  /** The selected document. */
  children: React.ReactNode
  indexWidth?: string
  className?: string
}) {
  return (
    // Pinned to the viewport so each side scrolls independently — the page
    // itself must not scroll, or we are back to nested scrollbars.
    <div className={cn('flex flex-col gap-4 lg:h-[calc(100vh-8.5rem)] lg:flex-row', className)}>
      <div className={cn('shrink-0 overflow-y-auto lg:h-full', indexWidth)}>{index}</div>
      <div className="min-w-0 flex-1 overflow-y-auto lg:h-full">{children}</div>
    </div>
  )
}
