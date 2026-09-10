"use client"

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import React from 'react'
import { linkifyContacts } from '@/lib/markdown'

interface MarkdownRendererProps {
  content: string
  className?: string
  linkifyContacts?: boolean
}

// Extend react-markdown's default URL allowlist to include tel: links.
// Default allows http(s), mailto, irc(s), xmpp — but not tel, which we need for clickable phone numbers.
function urlTransform(url: string, key: string, node: { tagName?: string }): string {
  if (key === 'href' && node.tagName === 'a' && url.startsWith('tel:')) return url
  return defaultUrlTransform(url)
}

/** Slug for a heading, matching the ids the /library outline links to. */
function headingId(children: React.ReactNode): string {
  const text = React.Children.toArray(children)
    .map(c => (typeof c === 'string' ? c : typeof c === 'number' ? String(c) : ''))
    .join('')
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function MarkdownRenderer({ content, className, linkifyContacts: shouldLinkify = false }: MarkdownRendererProps) {
  // Pre-process: replace [HUMAN DECISION NEEDED] with HTML badge
  let processed = content.replace(
    /\[HUMAN DECISION NEEDED\]/g,
    '<span class="human-decision-badge">HUMAN DECISION NEEDED</span>'
  )
  if (shouldLinkify) processed = linkifyContacts(processed)

  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={urlTransform}
        components={{
          // Anchors so an outline can link into the document. scroll-mt keeps
          // the target clear of the pane's top edge.
          h2: ({ children }) => <h2 id={headingId(children)} className="scroll-mt-4">{children}</h2>,
          h3: ({ children }) => <h3 id={headingId(children)} className="scroll-mt-4">{children}</h3>,
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
