import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { normalizeCronJob, type NormalizedCronJob } from './cron'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Result of a shell invocation.
 *
 * `ok` is the whole point: a command that FAILED and a command that succeeded
 * with no output both produce an empty string, and collapsing the two is how
 * the dashboard ended up rendering a confident green "System Healthy" while
 * openclaw was unreachable and it knew about zero jobs. Callers that report
 * health must branch on `ok`, never on `stdout` being empty.
 */
export interface CommandResult {
  ok: boolean
  stdout: string
}

export async function runCommandResult(command: string, timeoutMs = 10000): Promise<CommandResult> {
  try {
    const { stdout } = await execAsync(command, {
      timeout: timeoutMs,
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    console.error(`Command failed: ${command}`, error)
    return { ok: false, stdout: '' }
  }
}

export async function runCommand(command: string, timeoutMs = 10000): Promise<string> {
  return (await runCommandResult(command, timeoutMs)).stdout
}

// No shell involved: args reach the binary verbatim, so user-provided text can't inject.
export async function runCommandArgs(file: string, args: string[], timeoutMs = 10000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    })
    return stdout.trim()
  } catch (error) {
    console.error(`Command failed: ${file} ${args.join(' ')}`, error)
    return ''
  }
}

export async function getOpenClawStatus(): Promise<string> {
  return runCommand('openclaw status')
}

/**
 * Cron jobs plus whether openclaw could be reached at all.
 *
 * `reachable: false` means "we don't know" — it must never be reported as
 * healthy. `reachable: true` with `jobs: []` means openclaw genuinely has no
 * jobs configured, which IS a legitimate empty state.
 */
export interface CronFetch {
  reachable: boolean
  jobs: NormalizedCronJob[]
}

export async function getCronJobs(): Promise<{ reachable: boolean; raw: unknown[] }> {
  const { ok, stdout } = await runCommandResult('openclaw cron list --json')
  if (!ok) return { reachable: false, raw: [] }
  if (!stdout) return { reachable: true, raw: [] }
  try {
    const parsed = JSON.parse(stdout)
    // Handle both array and object with jobs key
    if (Array.isArray(parsed)) return { reachable: true, raw: parsed }
    if (parsed.jobs && Array.isArray(parsed.jobs)) return { reachable: true, raw: parsed.jobs }
    return { reachable: true, raw: [] }
  } catch {
    // Reached openclaw but couldn't parse what it said — that's a broken
    // contract, not a healthy empty roster.
    return { reachable: false, raw: [] }
  }
}

export async function getNormalizedCronJobs(): Promise<CronFetch> {
  const { reachable, raw } = await getCronJobs()
  return { reachable, jobs: raw.map(normalizeCronJob).filter(j => j.name) }
}

export async function getActiveClaudeProcesses(): Promise<number> {
  const output = await runCommand('ps aux | grep -c "[c]laude"')
  return parseInt(output, 10) || 0
}
