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
  // Content loop (Phase 9). Voice writes one file per weekly suggestion here;
  // the dashboard reads them and writes your pick/feedback back to the same
  // file. Lives in operations (not content-engine) so it sits with the bids and
  // intel it is generated from, and the janitor commits it like everything else.
  content: path.join(HOME, 'repos/operations/content'),
  contentSuggestions: path.join(HOME, 'repos/operations/content/suggestions'),
  // READ-ONLY inputs Voice reasons against — voice guides and the calendar.
  contentEngine: path.join(HOME, 'repos/content-engine'),
} as const
export const OUTREACH_PATH = path.join(HOME, 'repos/operations/intelligence/priority-outreach.md')
