import { exec, execFile } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export async function runCommand(command: string, timeoutMs = 10000): Promise<string> {
  try {
    const { stdout } = await execAsync(command, {
      timeout: timeoutMs,
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    })
    return stdout.trim()
  } catch (error) {
    console.error(`Command failed: ${command}`, error)
    return ''
  }
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

export async function getCronJobs(): Promise<unknown[]> {
  const output = await runCommand('openclaw cron list --json')
  if (!output) return []
  try {
    const parsed = JSON.parse(output)
    // Handle both array and object with jobs key
    if (Array.isArray(parsed)) return parsed
    if (parsed.jobs && Array.isArray(parsed.jobs)) return parsed.jobs
    return []
  } catch {
    return []
  }
}

export async function getActiveClaudeProcesses(): Promise<number> {
  const output = await runCommand('ps aux | grep -c "[c]laude"')
  return parseInt(output, 10) || 0
}
