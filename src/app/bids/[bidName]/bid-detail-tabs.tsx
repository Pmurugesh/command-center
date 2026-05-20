"use client"

import { useState } from 'react'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
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
      <div className="flex gap-1 overflow-x-auto pb-2 border-b border-border mb-4">
        {files.map((file) => (
          <button
            key={file.name}
            onClick={() => setActiveTab(file.name)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md whitespace-nowrap transition-colors flex-shrink-0",
              activeTab === file.name
                ? "bg-accent text-accent-foreground border-b-2 border-blue-400"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
          >
            {file.displayName}
            {file.flagCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1 py-0 ml-1">
                {file.flagCount}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      {activeFile && (
        <div className="rounded-lg border border-border p-6 bg-card">
          <MarkdownRenderer content={activeFile.content} />
        </div>
      )}
    </div>
  )
}
