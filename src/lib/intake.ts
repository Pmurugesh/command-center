import fs from 'fs/promises'
import path from 'path'
import { runCommandArgs } from './shell'

export const MAX_FILE_BYTES = 50 * 1024 * 1024

// Leading '_' or '.' would make the folder invisible to listBids(), so strip them.
export function slugifyBidName(name: string): string | null {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 80)
  return slug.length > 0 ? slug : null
}

export function sanitizeFilename(raw: string): string {
  const base = path
    .basename(raw)
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return base.length > 0 ? base : 'upload'
}

export function filesFromForm(form: FormData): { files: File[]; error?: string; status?: number } {
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { files, error: 'No files provided', status: 400 }
  const tooBig = files.find(f => f.size > MAX_FILE_BYTES)
  if (tooBig) return { files, error: `File too large (max 50MB): ${tooBig.name}`, status: 413 }
  return { files }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function saveFiles(destDir: string, files: File[]): Promise<string[]> {
  await fs.mkdir(destDir, { recursive: true })
  const saved: string[] = []
  for (const file of files) {
    const name = sanitizeFilename(file.name)
    const ext = path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    let target = path.join(destDir, name)
    for (let i = 1; await exists(target); i++) {
      target = path.join(destDir, `${stem}-${i}${ext}`)
    }
    await fs.writeFile(target, Buffer.from(await file.arrayBuffer()))
    saved.push(target)
  }
  return saved
}

export function buildAgentMessage(context: string, savedPaths: string[], note?: string): string {
  const lines = [`[Dashboard intake] ${context}`, '', 'Files:', ...savedPaths.map(p => `- ${p}`)]
  if (note && note.trim()) lines.push('', `Note from Pavan: ${note.trim()}`)
  lines.push('', 'Please process these files and confirm.')
  return lines.join('\n')
}

// Intentionally not awaited: an agent turn can take minutes and the HTTP response
// shouldn't wait for it. runCommandArgs never rejects, so this can't crash the route.
export function triggerAgent(message: string): void {
  void runCommandArgs(
    'openclaw',
    ['agent', '--message', message, '--deliver', '--channel', 'telegram'],
    300_000
  )
}
