"use client"

import { useState } from 'react'
import { Check, Copy, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AgencyActions({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false)

  if (emails.length === 0) return null

  const mailto = `mailto:${emails.join(',')}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join(', '))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail under non-secure contexts; fall back to a no-op.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={mailto}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
      >
        <Mail className="h-3.5 w-3.5" />
        Email all ({emails.length})
      </a>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs transition-colors",
          copied ? "text-status-success border-status-success/40" : "hover:bg-accent"
        )}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy emails'}
      </button>
    </div>
  )
}
