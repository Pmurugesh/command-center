"use client"

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { FileTree } from '@/components/shared/file-tree'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Search, X } from 'lucide-react'
import type { LibraryFile } from '@/types'

function flattenFiles(files: LibraryFile[]): LibraryFile[] {
  const result: LibraryFile[] = []
  for (const file of files) {
    if (!file.isDirectory) result.push(file)
    if (file.children) result.push(...flattenFiles(file.children))
  }
  return result
}

interface TreeItem {
  name: string
  displayName: string
  isDirectory: boolean
  path?: string
  children?: TreeItem[]
}

function toTreeItems(files: LibraryFile[]): TreeItem[] {
  return files.map(f => ({
    name: f.name,
    displayName: f.displayName,
    isDirectory: f.isDirectory,
    path: f.path,
    children: f.children ? toTreeItems(f.children) : undefined,
  }))
}

// Filter the tree by query — keeps a node if it matches OR any descendant matches.
function filterTree(items: TreeItem[], q: string): TreeItem[] {
  if (!q) return items
  const lower = q.toLowerCase()
  const result: TreeItem[] = []
  for (const item of items) {
    const selfMatch = item.displayName.toLowerCase().includes(lower) || item.name.toLowerCase().includes(lower)
    const childMatches = item.children ? filterTree(item.children, q) : []
    if (selfMatch || childMatches.length > 0) {
      result.push({
        ...item,
        children: item.children ? childMatches : undefined,
      })
    }
  }
  return result
}

export function LibraryBrowser({ files }: { files: LibraryFile[] }) {
  const allFiles = useMemo(() => flattenFiles(files), [files])
  const [selectedPath, setSelectedPath] = useState(allFiles[0]?.path || '')
  const [query, setQuery] = useState('')

  const selectedFile = allFiles.find(f => f.path === selectedPath)
  const treeItems = useMemo(() => toTreeItems(files), [files])
  const filteredTree = useMemo(() => filterTree(treeItems, query.trim()), [treeItems, query])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* File tree sidebar */}
      <Card className="lg:col-span-1 self-start">
        <CardContent className="p-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files..."
              className="w-full rounded-md border border-border bg-background pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {filteredTree.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 px-1">No files match "{query}"</p>
          ) : (
            <FileTree
              items={filteredTree}
              selectedPath={selectedPath}
              onSelect={(item) => {
                if (item.path) setSelectedPath(item.path)
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Content area */}
      <Card className="lg:col-span-3">
        <CardContent className="p-6">
          {selectedFile ? (
            <div>
              <h2 className="text-xl font-semibold mb-4">{selectedFile.displayName}</h2>
              <div className="max-w-3xl">
                <MarkdownRenderer content={selectedFile.content} />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Select a file from the tree to view its contents</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
