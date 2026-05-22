import fs from 'fs/promises'
import path from 'path'
import { PATHS } from './paths'
import { BID_TAB_ORDER, normalizeBidStatus } from './config'
import { countFlags } from './markdown'
import type { Bid, BidDetail, BidFile, BidStatusData, ScanReport, IntelAlert, LibraryFile, DocumentFile, DataSourceInfo, ScriptInfo } from '@/types'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function formatName(filename: string): string {
  return filename
    .replace(/\.md$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Bids ──

export async function listBids(): Promise<Bid[]> {
  if (!(await exists(PATHS.bids))) return []
  const entries = await fs.readdir(PATHS.bids, { withFileTypes: true })
  const bids: Bid[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const bidPath = path.join(PATHS.bids, entry.name)
    const files = await fs.readdir(bidPath)
    const mdFiles = files.filter(f => f.endsWith('.md'))
    const hasDocuments = await exists(path.join(bidPath, 'documents'))

    // Read status if available
    let status: BidStatusData | undefined
    const statusPath = path.join(bidPath, '.status.json')
    if (await exists(statusPath)) {
      try {
        const raw = await fs.readFile(statusPath, 'utf-8')
        status = JSON.parse(raw)
      } catch { /* ignore corrupt status */ }
    }

    // Updated-at: prefer status JSON, fall back to most-recent .md mtime in the bid dir
    let updatedAt: string | undefined = status?.updatedAt || undefined
    if (!updatedAt) {
      let latest = 0
      for (const f of mdFiles) {
        try {
          const st = await fs.stat(path.join(bidPath, f))
          if (st.mtimeMs > latest) latest = st.mtimeMs
        } catch { /* skip */ }
      }
      if (latest === 0) {
        try {
          const dirStat = await fs.stat(bidPath)
          latest = dirStat.mtimeMs
        } catch { /* skip */ }
      }
      if (latest > 0) updatedAt = new Date(latest).toISOString()
    }

    bids.push({
      name: entry.name,
      displayName: formatName(entry.name),
      files: mdFiles.map(f => f.replace('.md', '')),
      fileCount: mdFiles.length,
      status: normalizeBidStatus(status?.status),
      entity: status?.entity,
      hasDocuments,
      updatedAt,
    })
  }

  return bids
}

export async function getBidDetail(bidName: string): Promise<BidDetail | null> {
  const bidPath = path.join(PATHS.bids, bidName)
  if (!(await exists(bidPath))) return null

  const entries = await fs.readdir(bidPath)
  const mdFiles = entries.filter(f => f.endsWith('.md'))

  const files: BidFile[] = await Promise.all(
    mdFiles.map(async (filename) => {
      const content = await fs.readFile(path.join(bidPath, filename), 'utf-8')
      return {
        name: filename.replace('.md', ''),
        displayName: formatName(filename),
        content,
        flagCount: countFlags(content),
      }
    })
  )

  // Sort using the full tab ordering from config
  files.sort((a, b) => {
    const aIdx = BID_TAB_ORDER.indexOf(a.name as typeof BID_TAB_ORDER[number])
    const bIdx = BID_TAB_ORDER.indexOf(b.name as typeof BID_TAB_ORDER[number])
    if (aIdx === -1 && bIdx === -1) return a.name.localeCompare(b.name)
    if (aIdx === -1) return 1
    if (bIdx === -1) return -1
    return aIdx - bIdx
  })

  // Read documents
  let documents: DocumentFile[] = []
  const docsPath = path.join(bidPath, 'documents')
  if (await exists(docsPath)) {
    const docEntries = await fs.readdir(docsPath)
    documents = await Promise.all(
      docEntries.filter(f => !f.startsWith('.')).map(async (f) => {
        const stat = await fs.stat(path.join(docsPath, f))
        const ext = path.extname(f).toLowerCase().slice(1)
        return { name: f, size: stat.size, type: ext || 'file' }
      })
    )
  }

  // Read status
  let statusData: BidStatusData | undefined
  const statusPath = path.join(bidPath, '.status.json')
  if (await exists(statusPath)) {
    try {
      statusData = JSON.parse(await fs.readFile(statusPath, 'utf-8'))
    } catch { /* ignore */ }
  }

  const totalFlags = files.reduce((sum, f) => sum + f.flagCount, 0)

  return {
    name: bidName,
    displayName: formatName(bidName),
    files,
    status: normalizeBidStatus(statusData?.status),
    entity: statusData?.entity,
    documents,
    totalFlags,
  }
}

export async function readBidStatus(bidName: string): Promise<BidStatusData | null> {
  const statusPath = path.join(PATHS.bids, bidName, '.status.json')
  if (!(await exists(statusPath))) return null
  try {
    return JSON.parse(await fs.readFile(statusPath, 'utf-8'))
  } catch {
    return null
  }
}

export async function writeBidStatus(bidName: string, data: Partial<BidStatusData>): Promise<BidStatusData> {
  const statusPath = path.join(PATHS.bids, bidName, '.status.json')
  let existing: BidStatusData = { status: 'Discovered', entity: 'Infinite Solutions', updatedAt: '' }
  if (await exists(statusPath)) {
    try {
      existing = JSON.parse(await fs.readFile(statusPath, 'utf-8'))
    } catch { /* use defaults */ }
  }
  const updated: BidStatusData = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  }
  await fs.writeFile(statusPath, JSON.stringify(updated, null, 2))
  return updated
}

// ── Scan Reports ──

export async function listScanReports(): Promise<ScanReport[]> {
  if (!(await exists(PATHS.scanReports))) return []
  const entries = await fs.readdir(PATHS.scanReports)
  const reports: ScanReport[] = []

  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue
    const filePath = path.join(PATHS.scanReports, filename)
    const stat = await fs.stat(filePath)
    const content = await fs.readFile(filePath, 'utf-8')
    reports.push({
      name: filename.replace('.md', ''),
      displayName: formatName(filename),
      content,
      lastModified: stat.mtime.toISOString(),
      size: stat.size,
    })
  }

  return reports.sort((a, b) => b.lastModified.localeCompare(a.lastModified))
}

// ── Intelligence ──

export async function listIntelAlerts(): Promise<IntelAlert[]> {
  const alerts: IntelAlert[] = []
  const baseDir = path.dirname(PATHS.intelligence) // intelligence/ root

  // Scan all subdirectories: alerts, weekly, competitors, procurements
  const typeDirs: { dir: string; type: IntelAlert['type'] }[] = [
    { dir: PATHS.intelligence, type: 'daily' },
    { dir: path.join(baseDir, 'weekly'), type: 'weekly' },
    { dir: path.join(baseDir, 'procurements'), type: 'procurement' },
    { dir: path.join(baseDir, 'competitors'), type: 'competitor' },
  ]

  for (const { dir, type } of typeDirs) {
    if (!(await exists(dir))) continue
    const entries = await fs.readdir(dir)
    for (const filename of entries) {
      if (!filename.endsWith('.md')) continue
      const content = await fs.readFile(path.join(dir, filename), 'utf-8')
      const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/)
      alerts.push({
        filename,
        date: dateMatch ? dateMatch[1] : '',
        content,
        type,
      })
    }
  }

  return alerts.sort((a, b) => b.date.localeCompare(a.date))
}

// ── Response Library ──

export async function listLibraryFiles(): Promise<LibraryFile[]> {
  if (!(await exists(PATHS.responseLibrary))) return []
  return scanDirectory(PATHS.responseLibrary, PATHS.responseLibrary)
}

async function scanDirectory(dirPath: string, basePath: string): Promise<LibraryFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const items: LibraryFile[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(basePath, fullPath)

    if (entry.isDirectory()) {
      const children = await scanDirectory(fullPath, basePath)
      items.push({
        name: entry.name,
        displayName: formatName(entry.name),
        content: '',
        path: relativePath,
        isDirectory: true,
        children,
      })
    } else if (entry.name.endsWith('.md')) {
      const content = await fs.readFile(fullPath, 'utf-8')
      items.push({
        name: entry.name,
        displayName: formatName(entry.name),
        content,
        path: relativePath,
        isDirectory: false,
      })
    }
  }

  // Directories first, then files
  return items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
}

// ── System Info ──

export async function getDataSources(): Promise<DataSourceInfo[]> {
  const sources = [
    { name: 'Bids', path: PATHS.bids },
    { name: 'Response Library', path: PATHS.responseLibrary },
    { name: 'Scan Reports', path: PATHS.scanReports },
    { name: 'Intelligence Alerts', path: PATHS.intelligence },
    { name: 'Business Context', path: PATHS.businessContext },
    { name: 'Scheduled Tasks', path: PATHS.scheduledTasks },
  ]

  return Promise.all(
    sources.map(async (src) => {
      const pathExists = await exists(src.path)
      let fileCount = 0
      let lastModified: string | null = null

      if (pathExists) {
        try {
          const entries = await fs.readdir(src.path)
          fileCount = entries.filter(f => !f.startsWith('.')).length
          const stat = await fs.stat(src.path)
          lastModified = stat.mtime.toISOString()
        } catch { /* ignore */ }
      }

      return { name: src.name, path: src.path, exists: pathExists, fileCount, lastModified }
    })
  )
}

export async function listScripts(): Promise<ScriptInfo[]> {
  const scriptsPath = path.join(process.env.HOME || '/Users/paladin', '.openclaw/workspace/scripts')
  if (!(await exists(scriptsPath))) return []

  const entries = await fs.readdir(scriptsPath)
  const scripts: ScriptInfo[] = []

  for (const filename of entries) {
    if (filename.startsWith('.')) continue
    const fullPath = path.join(scriptsPath, filename)
    const stat = await fs.stat(fullPath)
    if (!stat.isFile()) continue

    // Try to extract description from first comment line
    let description = ''
    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines.slice(1, 10)) { // Skip shebang, check first few lines
        const match = line.match(/^#\s*(.+)/)
        if (match) {
          description = match[1]
          break
        }
      }
    } catch { /* ignore */ }

    scripts.push({ name: filename, path: fullPath, size: stat.size, description })
  }

  return scripts
}
