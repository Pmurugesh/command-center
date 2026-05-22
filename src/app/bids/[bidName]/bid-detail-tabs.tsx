"use client"

import { useState } from 'react'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { cn } from '@/lib/utils'
import { AlertCircle } from 'lucide-react'
import type { BidFile } from '@/types'

export function BidDetailTabs({ files }: { files: BidFile[] }) {
  const [activeTab, setActiveTab] = useState(files[0]?.name || '')

  if (files.length === 0) {
    return <p className="text-muted-foreground">No documents found for this bid.</p>
  }

  const activeFile = files.find(f => f.name === activeTab)

  return (
    <div>
      {/* Tab list - scrollable */}
      <div className="flex gap-1 overflow-x-auto pb-0 border-b border-border mb-4">
        {files.map((file) => {
          const isActive = activeTab === file.name
          return (
            <button
              key={file.name}
              onClick={() => setActiveTab(file.name)}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap transition-colors flex-shrink-0 border-b-2 -mb-px",
                isActive
                  ? "text-foreground border-status-accent"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
              title={file.flagCount > 0 ? `${file.flagCount} decision flag${file.flagCount > 1 ? 's' : ''}` : undefined}
            >
              <span>{file.displayName}</span>
              {file.flagCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-status-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-status-danger font-mono tabular-nums">
                  <AlertCircle className="h-2.5 w-2.5" />
                  {file.flagCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Active tab content — markdown reads better at constrained width */}
      {activeFile && (
        <div className="rounded-lg border border-border bg-card">
          <div className="max-w-3xl mx-auto p-6 md:p-8">
            <MarkdownRenderer content={activeFile.content} />
          </div>
        </div>
      )}
    </div>
  )
}
