/**
 * The one client for the qual-table workbench (Pmurugesh/qual_table_automations).
 *
 * Shared by every connector that reads from that app (`scripts/sync-leads.ts`,
 * `scripts/sync-bids.ts`) so the auth flow, the timeout and the "not configured"
 * message exist exactly once. Every call here is a READ. A write to their app is
 * a decision to make with that team, not a code change — see
 * operations/gtm/lead-search-handoff.md and
 * operations/workflows/unified-bid-system-handoff.md.
 *
 * Config comes from the environment only. On the mini the five values live in
 * ~/.openclaw/workspace/.credentials/qual-table.env (mode 600, outside git); the
 * cron installers source that file. Verified working 2026-09-08.
 */

export interface QualTableConfig {
  apiUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  email: string
  password: string
}

/** Default per-request budget. Measured from the mini on 2026-09-08: sign-in
 *  0.5 s; the first /bids/summary read after a quiet spell 16.7 s, then 2.0 s and
 *  1.1 s warm; discovery 2.2 s. Render is always-on since 2026-09-07 but the
 *  first request still pays a warm-up, so 20 s failed the installer's dry run.
 *  60 s covers the cold case with room; past that it is a real failure. */
export const QUAL_TABLE_TIMEOUT_MS = 60_000

export const QUAL_TABLE_CONFIG_HELP = [
  'Not configured. Set on the mini (see ~/.openclaw/workspace/.credentials/qual-table.env):',
  '  QUAL_TABLE_API_URL           the qual-table Render URL',
  '  QUAL_TABLE_SUPABASE_URL      its Supabase project URL',
  '  QUAL_TABLE_SUPABASE_ANON_KEY its anon key (not secret)',
  '  QUAL_TABLE_EMAIL             the Paladin service account',
  '  QUAL_TABLE_PASSWORD          its password',
]

/**
 * Read from the environment only. Mirrors their own `is_enabled` gate: an
 * unconfigured deploy exits cleanly rather than half-working.
 */
export function getQualTableConfig(): QualTableConfig | null {
  const c = {
    apiUrl: (process.env.QUAL_TABLE_API_URL ?? '').replace(/\/+$/, ''),
    supabaseUrl: (process.env.QUAL_TABLE_SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseAnonKey: process.env.QUAL_TABLE_SUPABASE_ANON_KEY ?? '',
    email: process.env.QUAL_TABLE_EMAIL ?? '',
    password: process.env.QUAL_TABLE_PASSWORD ?? '',
  }
  return Object.values(c).every(Boolean) ? c : null
}

/**
 * Exchange the service-account credentials for a short-lived access token.
 * Done per run because Supabase access tokens expire in about an hour, so a
 * stored token would break a scheduled sync by the next day.
 */
export async function signIn(c: QualTableConfig, timeoutMs = QUAL_TABLE_TIMEOUT_MS): Promise<string> {
  const res = await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: c.supabaseAnonKey },
    body: JSON.stringify({ email: c.email, password: c.password }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`sign-in failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const body = await res.json() as { access_token?: string }
  if (!body.access_token) throw new Error('sign-in returned no access_token')
  return body.access_token
}

/**
 * One authenticated GET against their API. `path` starts with `/api/v1/...`.
 *
 * 401 and 403 are named because they mean different things on their side since
 * the 2026-09-07 multitenancy change: 401 is a bad token, 403 is a valid user
 * with no organization membership ("Your account is not part of an
 * organization yet."). Both are the qual-table team's fix, not ours.
 */
export async function fetchJson<T>(
  c: QualTableConfig,
  token: string,
  path: string,
  timeoutMs = QUAL_TABLE_TIMEOUT_MS,
): Promise<T> {
  const res = await fetch(`${c.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new Error('401 — the service account is not authorised')
  if (res.status === 403) throw new Error('403 — the service account has no organization membership in the workbench')
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  return await res.json() as T
}
