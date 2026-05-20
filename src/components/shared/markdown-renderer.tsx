"use client"

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import React from 'react'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  // Pre-process: replace [HUMAN DECISION NEEDED] with HTML badge
  const processed = content.replace(
    /\[HUMAN DECISION NEEDED\]/g,
    '<span class="human-decision-badge">HUMAN DECISION NEEDED</span>'
  )

  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
