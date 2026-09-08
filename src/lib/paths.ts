import path from 'path'

const HOME = process.env.HOME || '/Users/paladin'

export const PATHS = {
  bids: path.join(HOME, 'repos/operations/bids'),
  platformKnowledge: path.join(HOME, 'repos/operations/bids/_platform-knowledge.md'),
  requirementTracker: path.join(HOME, 'repos/operations/bids/_requirement-tracker.md'),
  responseLibrary: path.join(HOME, 'repos/operations/bids/_response-library'),
  scanReports: path.join(HOME, 'repos/operations/codebase-reports'),
  intelligence: path.join(HOME, 'repos/operations/intelligence/alerts'),
  intelligenceBase: path.join(HOME, 'repos/operations/intelligence'),
  businessContext: path.join(HOME, '.openclaw/workspace/business'),
  scheduledTasks: path.join(HOME, '.claude/scheduled-tasks'),
  scripts: path.join(HOME, '.openclaw/workspace/scripts'),
  agencies: path.join(HOME, 'repos/operations/intelligence/agencies'),
  partnerships: path.join(HOME, 'repos/operations/intelligence/partnerships'),
  inbox: path.join(HOME, 'repos/operations/inbox'),
  // Google Calendar secret iCal URLs — lives with the other credentials,
  // outside every git repo (it's a bearer-style secret URL).
  calendarConfig: path.join(HOME, '.openclaw/workspace/.credentials/calendar.json'),
  // CRM store (Phase 5 / M1). operationsRoot is the git repo root — crm.ts
  // commits relative to it, so every write lands in the same history as the
  // bids and intel it references.
  operationsRoot: path.join(HOME, 'repos/operations'),
  // GTM strategy docs + the campaign targets file the scoreboard reads.
  gtm: path.join(HOME, 'repos/operations/gtm'),
  gtmTargets: path.join(HOME, 'repos/operations/gtm/targets.md'),
  crm: path.join(HOME, 'repos/operations/crm'),
  crmContacts: path.join(HOME, 'repos/operations/crm/contacts'),
  crmMeetings: path.join(HOME, 'repos/operations/crm/meetings'),
  crmDrafts: path.join(HOME, 'repos/operations/crm/drafts'),
  crmLeads: path.join(HOME, 'repos/operations/crm/leads'),
  // Email intake (M3.5). The staging dir is gitignored raw events, local to the
  // machine that runs the connector; the review queue is distilled facts and
  // lives in git like the rest of the store.
  crmIntakeEmail: path.join(HOME, 'repos/operations/crm/intake/email'),
  crmIntakeReview: path.join(HOME, 'repos/operations/crm/intake/review'),
  emailSyncLog: path.join(HOME, '.openclaw/logs/email-sync.log'),
  // Bid connector (Phase 11). One line per run, success or failure; the Today
  // freshness row reads the last success. An event log, never in git.
  bidSyncLog: path.join(HOME, '.openclaw/logs/bid-sync.log'),
  // Roadmap check (Phase 12). Same contract: one line per run, the page reads
  // the last success for freshness — so a check that found nothing to change
  // (and therefore wrote nothing to git) still counts as having run.
  roadmapCheckLog: path.join(HOME, '.openclaw/logs/roadmap-check.log'),
  // Content loop (Phase 9). Voice writes one file per weekly suggestion here;
  // the dashboard reads them and writes your pick/feedback back to the same
  // file. Lives in operations (not content-engine) so it sits with the bids and
  // intel it is generated from, and the janitor commits it like everything else.
  content: path.join(HOME, 'repos/operations/content'),
  contentSuggestions: path.join(HOME, 'repos/operations/content/suggestions'),
  // READ-ONLY inputs Voice reasons against — voice guides and the calendar.
  contentEngine: path.join(HOME, 'repos/content-engine'),
  // Roadmap (Phase 12). Authored commitment files plus the DERIVED `_status.md`
  // that scripts/roadmap-check.ts regenerates. Authored and derived never share
  // a file — the registry doctrine, applied to dates.
  roadmap: path.join(HOME, 'repos/operations/roadmap'),
  roadmapStatus: path.join(HOME, 'repos/operations/roadmap/_status.md'),
} as const

/**
 * Every repo the roadmap can cite, and where it might live.
 *
 * Two machines, two layouts: the MacBook keeps the platform at
 * `~/infiniteai_platform` and the dashboard at `~/command-center`, the mini
 * keeps everything under `~/repos/`. `verify-claims.ts` already carried a
 * two-candidate list for the dashboard; this generalizes it rather than making
 * a third copy (Phase 11 flagged `verify-claims.ts:29` and
 * `generate-registry.ts:26` each re-deriving the platform path privately).
 *
 * EVERY repo here except command-center and operations is READ-ONLY. Callers
 * fetch and read `origin/main`; nothing writes, and nothing trusts a working
 * tree — on 2026-09-08 the mini's contract-management clone was 98 days behind
 * its own origin.
 */
export const REPO_CANDIDATES: Record<string, string[]> = {
  // The platform monorepo. `Nexus` is its canonical name (NovaEraSolutions/Nexus);
  // `infiniteai_platform` is only what the MacBook happens to call the clone.
  'Nexus': [path.join(HOME, 'repos/Nexus'), path.join(HOME, 'infiniteai_platform')],
  'command-center': [path.join(HOME, 'repos/command-center'), path.join(HOME, 'command-center')],
  'operations': [path.join(HOME, 'repos/operations')],
  'contract-management': [path.join(HOME, 'repos/contract-management')],
  'qual_table_automations': [path.join(HOME, 'repos/qual_table_automations')],
  'infiniteai-website': [path.join(HOME, 'repos/infiniteai-website')],
  'is-website': [path.join(HOME, 'repos/is-website')],
}
export const OUTREACH_PATH = path.join(HOME, 'repos/operations/intelligence/priority-outreach.md')
