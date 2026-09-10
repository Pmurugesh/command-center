"use client"

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Reader } from '@/components/layout/reader'
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

  // These files carry 14–27 headings each, which is exactly the case an outline
  // serves — and the freed left gutter is where it goes.
  const outline = useMemo(() => {
    if (!selectedFile) return [] as { level: number; text: string; id: string }[]
    return selectedFile.content.split('\n')
      .map(l => l.match(/^(#{2,3})\s+(.+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => ({
        level: m[1].length,
        text: m[2].replace(/[*`]/g, '').trim(),
        id: m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      }))
  }, [selectedFile])

  return (
    // Reader, not a 1+3 grid. The tree held 6 files and was `self-start`, so it
    // collapsed to ~250px beside a 4,200px reader — the largest dead region in
    // the app. A full-height index has no gutter to leave empty.
    <Reader
      indexWidth="lg:w-[20rem] 3xl:w-[22rem]"
      index={
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files..."
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-7 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Card>
            <CardContent className="p-2">
              {filteredTree.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">No files match &ldquo;{query}&rdquo;</p>
              ) : (
                <FileTree items={filteredTree} selectedPath={selectedPath}
                  onSelect={(item) => { if (item.path) setSelectedPath(item.path) }} />
              )}
            </CardContent>
          </Card>
          {outline.length > 0 && (
            <Card>
              <CardContent className="p-2">
                <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">In this file</p>
                <ul className="space-y-0.5">
                  {outline.map((h, i) => (
                    <li key={i}>
                      <a href={`#${h.id}`} title={h.text}
                        className={`block truncate rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground ${h.level === 3 ? 'pl-4' : ''}`}>
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      }
    >
      <Card>
        <CardContent className="p-4 md:p-5">
          {selectedFile ? (
            <>
              <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold">{selectedFile.displayName}</h2>
              {/* No max-w here: the measure policy caps prose and lets these
                  files' 42-row tables use the full pane. */}
              <MarkdownRenderer content={selectedFile.content} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a file from the tree to view its contents</p>
          )}
        </CardContent>
      </Card>
    </Reader>
  )
}
