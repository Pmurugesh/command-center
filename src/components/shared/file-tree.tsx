"use client"

import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileTreeItem {
  name: string
  displayName: string
  isDirectory: boolean
  children?: FileTreeItem[]
  path?: string
  size?: number
}

interface FileTreeProps {
  items: FileTreeItem[]
  onSelect?: (item: FileTreeItem) => void
  selectedPath?: string
}

export function FileTree({ items, onSelect, selectedPath }: FileTreeProps) {
  return (
    <div className="text-sm">
      {items.map((item) => (
        <FileTreeNode
          key={item.name}
          item={item}
          depth={0}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  )
}

function FileTreeNode({
  item,
  depth,
  onSelect,
  selectedPath,
}: {
  item: FileTreeItem
  depth: number
  onSelect?: (item: FileTreeItem) => void
  selectedPath?: string
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const isSelected = item.path === selectedPath

  const handleClick = () => {
    if (item.isDirectory) {
      setExpanded(!expanded)
    } else {
      onSelect?.(item)
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1 rounded hover:bg-accent/50 transition-colors text-left',
          isSelected && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {item.isDirectory ? (
          <>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}
            {expanded ? (
              <FolderOpen className="h-4 w-4 text-blue-400 flex-shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-blue-400 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </>
        )}
        <span className="truncate">{item.displayName}</span>
        {item.size !== undefined && !item.isDirectory && (
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
            {formatFileSize(item.size)}
          </span>
        )}
      </button>
      {item.isDirectory && expanded && item.children && (
        <div>
          {item.children.map((child) => (
            <FileTreeNode
              key={child.name}
              item={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
