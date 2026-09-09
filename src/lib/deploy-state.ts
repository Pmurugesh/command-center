/**
 * What code is the mini actually serving?
 *
 * `scripts/mini/deploy-on-merge.sh` pulls and rebuilds whenever origin/main
 * moves. When that build FAILS it logs a line and keeps the OLD bundle serving,
 * on purpose — a broken build should not take the dashboard down. The cost of
 * that choice is that a broken main does not look broken: the dashboard renders
 * normally and is quietly weeks behind, and the only trace is a line in
 * `~/.openclaw/logs/command-center-deploy.log` that nothing reads.
 *
 * The deploy script now writes a machine-readable state file at every exit path
 * — including the skips, because "did not deploy because the tree was dirty" is
 * exactly as important as "deployed". This reads it.
 *
 * Deliberately machine-local (`~/.openclaw/state/`) rather than in operations:
 * it describes THIS host, and syncing it through the janitor would mean the
 * MacBook and the mini overwrite each other's answer to "what am I running".
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

export const DEPLOY_STATE_PATH =
  path.join(os.homedir(), '.openclaw/state/command-center-deploy.json')

export type DeployResult =
  | 'current' | 'deployed' | 'build-failed' | 'pull-failed'
  | 'skipped-dirty' | 'skipped-branch'

export interface DeployState {
  at: string
  result: DeployResult
  /** The commit actually being served. */
  sha: string
  /** What origin/main was at that moment. */
  target: string
  subject?: string
  host?: string
  http?: number
  branch?: string
}

export interface DeployView extends DeployState {
  /** Serving something older than origin/main. */
  behind: boolean
  /** Worth interrupting someone about. */
  severity: 'ok' | 'warn' | 'danger'
  headline: string
  ageHours: number
}

const HEADLINE: Record<DeployResult, string> = {
  current: 'Serving origin/main',
  deployed: 'Deployed and serving origin/main',
  'build-failed': 'BUILD FAILED — serving older code',
  'pull-failed': 'Pull failed — serving older code',
  'skipped-dirty': 'Not deploying — working tree is dirty on the mini',
  'skipped-branch': 'Not deploying — the mini is not on main',
}

export function viewDeploy(s: DeployState, now: Date = new Date()): DeployView {
  const behind = s.sha !== s.target
  // A failed build that leaves old code serving is the dangerous one: everything
  // looks fine. A skip is a warning — someone is mid-work on the mini, which is
  // a choice rather than a fault.
  const severity: DeployView['severity'] =
    s.result === 'build-failed' || s.result === 'pull-failed' ? 'danger'
      : behind ? 'warn' : 'ok'
  return {
    ...s,
    behind,
    severity,
    headline: HEADLINE[s.result] ?? s.result,
    ageHours: Math.round(((now.getTime() - new Date(s.at).getTime()) / 3_600_000) * 10) / 10,
  }
}

/** Null when the file is absent — i.e. this machine is not a deploy target. */
export async function readDeployState(): Promise<DeployView | null> {
  try {
    const raw = JSON.parse(await fs.readFile(DEPLOY_STATE_PATH, 'utf-8')) as DeployState
    if (!raw?.at || !raw?.result) return null
    return viewDeploy(raw)
  } catch {
    return null
  }
}
