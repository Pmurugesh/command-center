/**
 * Shared write primitives for the file-backed stores under `operations/`.
 *
 * Extracted from crm.ts so the leads store cannot re-derive them. The lock in
 * particular already carried one real bug (every mkdir failure was treated as
 * contention, so a missing parent directory burned the full timeout and then
 * reported the wrong cause); a second copy would eventually reacquire it.
 */
import fs from 'fs/promises'
import path from 'path'

const LOCK_STALE_MS = 30_000
const LOCK_RETRY_MS = 50
const LOCK_MAX_WAIT_MS = 10_000

/**
 * Cross-process mutual exclusion via mkdir, which is atomic on POSIX: exactly
 * one caller wins. Used rather than an in-process mutex because OpenClaw agents
 * and sync jobs write from separate processes, where an in-process lock would be
 * theatre.
 *
 * `ensureDir` is created before locking, since the lock's own mkdir is
 * non-recursive on purpose — that is what makes it atomic.
 */
export async function acquireLock(lockRoot: string, ensureDir = lockRoot): Promise<() => Promise<void>> {
  const lockDir = path.join(lockRoot, '.write-lock')
  const deadline = Date.now() + LOCK_MAX_WAIT_MS

  await fs.mkdir(ensureDir, { recursive: true })

  for (;;) {
    try {
      await fs.mkdir(lockDir)
      return async () => { await fs.rm(lockDir, { recursive: true, force: true }) }
    } catch (err) {
      // ONLY EEXIST means another writer holds it. Anything else (EACCES,
      // ENOENT, EROFS) is a real failure that must surface immediately —
      // spinning on it burns the timeout and then reports the wrong cause.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err

      try {
        const st = await fs.stat(lockDir)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          // Orphaned by a crashed process — a dead writer must not wedge the
          // dashboard permanently.
          await fs.rm(lockDir, { recursive: true, force: true })
          continue
        }
      } catch { /* vanished between calls — retry */ }

      if (Date.now() > deadline) throw new Error(`write lock timeout (10s) on ${lockRoot}`)
      await new Promise(r => setTimeout(r, LOCK_RETRY_MS))
    }
  }
}

/** Write a sibling temp file then rename over the target, so a crash can never truncate a record. */
export async function atomicWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, target)
}

export async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}
