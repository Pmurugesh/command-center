"use client"

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { FileTree } from '@/components/shared/file-tree'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import type { LibraryFile } from '@/types'

function flattenFiles(files: LibraryFile[]): LibraryFile[] {
  const result: LibraryFile[] = []
  for (const file of files) {
    if (!file.isDirectory) result.push(file)
    if (file.children) result.push(...flattenFiles(file.children))
  }
  return result
}

function toTreeItems(files: LibraryFile[]): Array<{ name: string; displayName: string; isDirectory: boolean; path?: string; children?: any[] }> {
  return files.map(f => ({
    name: f.name,
    displayName: f.displayName,
    isDirectory: f.isDirectory,
    path: f.path,
    children: f.children ? toTreeItems(f.children) : undefined,
  }))
}

export function LibraryBrowser({ files }: { files: LibraryFile[] }) {
  const allFiles = flattenFiles(files)
  const [selectedPath, setSelectedPath] = useState(allFiles[0]?.path || '')

  const selectedFile = allFiles.find(f => f.path === selectedPath)
  const treeItems = toTreeItems(files)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* File tree sidebar */}
      <Card className="lg:col-span-1">
        <CardContent className="p-3">
          <FileTree
            items={treeItems}
            selectedPath={selectedPath}
            onSelect={(item) => {
              if (item.path) setSelectedPath(item.path)
            }}
          />
        </CardContent>
      </Card>

      {/* Content area */}
      <Card className="lg:col-span-3">
        <CardContent className="p-6">
          {selectedFile ? (
            <div>
              <h2 className="text-xl font-semibold mb-4">{selectedFile.displayName}</h2>
              <div className="rounded-lg border border-border p-4 bg-background max-h-[700px] overflow-y-auto">
                <MarkdownRenderer content={selectedFile.content} />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Select a file from the tree to view its contents</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
