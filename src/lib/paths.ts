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
} as const
