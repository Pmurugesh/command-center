/**
 * Cross-site request guard for the API.
 *
 * The dashboard has no auth: it is reachable only over Tailscale Serve, and
 * that is the trust boundary. A browser on the tailnet, though, can be
 * steered by any web page it has open into POSTing here — multipart forms
 * need no CORS preflight — and the intake routes hand that request to an
 * OpenClaw agent (audit 2026-09-14). Browsers stamp every request with
 * `Sec-Fetch-Site`, which says where it came from and which a page cannot
 * forge. Anything but the dashboard's own origin is refused for a mutating
 * method. `same-site` is refused too: on a shared tailnet domain that would
 * include every other device's Serve page.
 *
 * Non-browser clients (curl from a script, the cron runner) send no
 * `Sec-Fetch-Site`; they are allowed through, but only when they also send no
 * foreign `Origin`, so an old browser without fetch metadata still cannot be
 * used cross-origin.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type GuardVerdict = { allow: true } | { allow: false; reason: string }

export function crossSiteVerdict(
  method: string,
  headers: { get(name: string): string | null },
): GuardVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return { allow: true }

  const site = headers.get('sec-fetch-site')
  if (site !== null) {
    if (site === 'same-origin' || site === 'none') return { allow: true }
    return { allow: false, reason: `Sec-Fetch-Site is "${site}"; only same-origin requests may modify data` }
  }

  const origin = headers.get('origin')
  const host = headers.get('host')
  if (origin && origin !== 'null') {
    let originHost: string | null = null
    try { originHost = new URL(origin).host } catch { originHost = null }
    if (!host || originHost !== host) {
      return { allow: false, reason: `Origin "${origin}" does not match this host` }
    }
  }
  return { allow: true }
}
