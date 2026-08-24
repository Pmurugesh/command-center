// Markdown utilities - we use react-markdown on the client side
// This file provides server-side helpers for extracting metadata from markdown

import type { AgencyPriority, Partnership, PartnershipStatus, Contact } from '@/types'

export function extractFirstHeading(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1] : ''
}

export function extractSections(content: string): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = []
  const lines = content.split('\n')
  let currentHeading = ''
  let currentContent: string[] = []

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/)
    if (headingMatch) {
      if (currentHeading || currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() })
      }
      currentHeading = headingMatch[1]
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  if (currentHeading || currentContent.length > 0) {
    sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() })
  }

  return sections
}

export function countFlags(content: string, flag = '[HUMAN DECISION NEEDED]'): number {
  let n = 0
  for (let i = content.indexOf(flag); i !== -1; i = content.indexOf(flag, i + flag.length)) n++
  return n
}

export interface FlagLocation {
  index: number      // 1-based: 1st flag in file, 2nd, etc.
  lineNumber: number // 1-based line number
  snippet: string    // the flag line + 2 lines of trailing context, joined with \n
}

/**
 * Walk the markdown content yielding every flag's location (default:
 * [HUMAN DECISION NEEDED]), with a short context snippet (the flag line + up to
 * 2 following lines, trimmed). Flags are matched as literal substrings.
 */
export function iterateFlags(content: string, flag = '[HUMAN DECISION NEEDED]'): FlagLocation[] {
  const lines = content.split('\n')
  const flags: FlagLocation[] = []
  let count = 0

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(flag)) continue
    count += 1
    // Pull a small context window — current line + up to 2 following lines.
    // Skip blank lines in the trailing window so the snippet stays informative.
    const window: string[] = [lines[i]]
    let added = 0
    for (let j = i + 1; j < lines.length && added < 2; j++) {
      const t = lines[j].trim()
      if (!t) continue
      window.push(lines[j])
      added += 1
    }
    flags.push({
      index: count,
      lineNumber: i + 1,
      snippet: window.join('\n').trim(),
    })
  }

  return flags
}

export function extractDeltaIndicators(content: string): { new: number; resolved: number; unchanged: number } {
  const newCount = (content.match(/\*\*NEW\*\*|\[NEW\]|🆕/g) || []).length
  const resolvedCount = (content.match(/\*\*RESOLVED\*\*|\[RESOLVED\]/g) || []).length
  const unchangedCount = (content.match(/\*\*UNCHANGED\*\*|\[UNCHANGED\]|UNCHANGED/g) || []).length
  return { new: newCount, resolved: resolvedCount, unchanged: unchangedCount }
}

export function extractCriticalCount(content: string): number {
  // Count findings explicitly labeled critical. HIGH is deliberately excluded —
  // it's a different tier (e.g. "test coverage: HIGH priority"), and counting it
  // here is what once inflated the header to a permanent 34 "critical findings".
  const criticalMatches = content.match(/\*\*Critical\*\*|severity:\s*critical|🔴\s*Critical/gi) || []
  return criticalMatches.length
}

/**
 * True only when a critical/high-relevance section actually contains entries.
 * Every scan template includes a "Critical Alerts" heading (often followed by
 * "none today"), so matching the word "critical" alone badges everything.
 */
export function hasCriticalContent(content: string): boolean {
  for (const section of content.split(/\n(?=## )/)) {
    const heading = section.split('\n', 1)[0] ?? ''
    if (!heading.startsWith('##')) continue
    if (!/🔴|🚨|critical|urgent/i.test(heading)) continue
    // An actionable section has at least one ### entry under it.
    if (/^###\s+\S/m.test(section)) return true
  }
  return false
}

export function extractExecutiveSummary(content: string): string {
  const sections = extractSections(content)
  const summarySection = sections.find(s =>
    /executive\s+summary|summary|overview|key\s+findings/i.test(s.heading)
  )
  if (summarySection) return summarySection.content
  // Fallback: first 500 chars
  const firstContent = content.replace(/^#.*$/m, '').trim()
  return firstContent.slice(0, 500)
}

// ── Relationships parsing ──

const PRIORITY_VALUES: AgencyPriority[] = ['high', 'medium', 'low']

export function extractPriority(content: string, frontmatter?: Record<string, unknown>): AgencyPriority {
  const fmRaw = frontmatter?.priority
  if (typeof fmRaw === 'string') {
    const v = fmRaw.toLowerCase().trim() as AgencyPriority
    if (PRIORITY_VALUES.includes(v)) return v
  }
  // Allow optional list-bullet prefix (- / * / +) so bullet-formatted lines like
  // `- Priority: **HIGH** -- description` are picked up alongside plain / bold-wrapped variants.
  const match = content.match(/(?:^|\n)\s*(?:[-*+]\s+)?\**\s*priority\s*\**\s*[:\-]\s*\**\s*(high|medium|low)\b/i)
  if (match) return match[1].toLowerCase() as AgencyPriority
  return 'medium'
}

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

export function extractEmails(content: string): string[] {
  const seen = new Set<string>()
  for (const m of content.match(EMAIL_REGEX) || []) seen.add(m)
  return Array.from(seen)
}

const STATUS_PATTERNS: { status: PartnershipStatus; pattern: RegExp }[] = [
  { status: 'active', pattern: /\bactive\b/i },
  { status: 'in-contact', pattern: /\bin[\s-]?contact\b/i },
  { status: 'potential', pattern: /\bpotential\b/i },
]

function detectStatus(text: string): PartnershipStatus {
  const statusLine = text.match(/(?:^|\n)\s*\**\s*status\s*\**\s*[:\-]\s*([^\n]+)/i)
  const scanTarget = statusLine ? statusLine[1] : text
  for (const { status, pattern } of STATUS_PATTERNS) {
    if (pattern.test(scanTarget)) return status
  }
  return 'unknown'
}

// Patterns we DON'T want as a "name" — these are labels / org roles, not people.
const NAME_BLOCKLIST = /^(general|info|hello|contact|inbox|email|primary[\s-]?contact|lead[\s-]?contact|main[\s-]?contact|reception|front[\s-]?desk|phone[\s-]?tree|reach[\s-]?out|sales|support|admin|webmaster)\b/i

// Leading-label prefixes to strip ("Contact: Jane" → "Jane"). Matched before any other cleanup
// so trailing-separator stripping later doesn't eat the colon and leave the label as the "name".
const LABEL_PREFIX = /^\s*(?:[\s\-•+>]+\s*)?(?:contact|lead\s+contact|primary\s+contact|main\s+contact|email|inbox|reach\s+out|sales\s+contact|phone\s+tree)\s*[:\-–—]\s+/i

export function extractContacts(content: string): Contact[] {
  const emails = extractEmails(content)
  return emails.map(email => {
    // Find the line containing this email, and the text BEFORE the email on that line.
    const escaped = email.replace(/[.+\-]/g, '\\$&')
    const lineRegex = new RegExp(`([^\\n]*?)\\b${escaped}\\b`, 'i')
    const lineMatch = content.match(lineRegex)
    if (!lineMatch) return { email }

    let before = lineMatch[1]

    // 1. Strip leading labels FIRST (before we eat their trailing colon).
    before = before.replace(LABEL_PREFIX, '')

    // 2. Collapse markdown wrappers around the name part.
    before = before
      .replace(/`/g, '')                              // code ticks
      .replace(/\[([^\]]+)\]\([^)]*\)?/g, '$1')       // [text](url) → text (handle truncated url too)
      .replace(/\[|\]/g, '')                           // any remaining brackets from partial links
      .replace(/<|>/g, ' ')                            // angle-bracket autolinks
      .replace(/\*\*|\*|_/g, '')                       // bold / italic
      .replace(/mailto:/gi, '')

    // 3. Drop leading bullets / list markers.
    before = before.replace(/^[\s\-•+>]+/, '').trim()

    // 4. Drop trailing separators between the name part and the email.
    before = before
      .replace(/\s*[-–—:|]\s*$/, '')                  // " — " or " : " before email
      .replace(/\s*\(\s*$/, '')                       // dangling "(" before <email>
      .trim()

    // 5. Drop a trailing role chunk:
    //    "Mike Johnson, IT Solutions Lead" → "Mike Johnson"
    //    "Mike Johnson (IT Solutions Lead)" → "Mike Johnson"
    let candidate = before
      .replace(/\s*\([^)]*\)\s*$/, '')                // " (Role)" at end
      .split(/\s*,\s*/)
      .filter(p => p.length > 0)[0]
      || ''
    candidate = candidate.trim()

    // 6. Sanity-check: real names are short, mostly Title-Case, not a label.
    //    Require first AND last word to start with an uppercase letter — this
    //    rejects narrative fragments ("Just an email at <addr>") while keeping
    //    multi-part names ("Bob van der Berg" — first 'Bob' cap, last 'Berg' cap).
    const words = candidate.split(/\s+/).filter(Boolean)
    // Uppercase: ASCII A-Z plus Latin-1 supplement uppercase (À-Þ, excluding ×)
    const startsCapital = (w: string) => /^[A-ZÀ-ÖØ-Þ]/.test(w)
    const firstCap = words.length > 0 && startsCapital(words[0])
    const lastCap = words.length > 0 && startsCapital(words[words.length - 1])
    const isLikelyName =
      candidate.length > 0 &&
      candidate.length <= 80 &&
      words.length >= 1 &&
      words.length <= 6 &&
      firstCap &&
      lastCap &&
      !NAME_BLOCKLIST.test(candidate)

    return isLikelyName ? { name: candidate, email } : { email }
  })
}

// Find a "next action" line: matches `Next:`, `Next step:`, `Next steps:`, `Action:`, `Action item:`,
// `Follow up:`, `Follow-up:` — with optional bullet/bold prefixes. Returns the action text, or undefined.
export function extractNextAction(content: string): string | undefined {
  const re = /(?:^|\n)\s*(?:[-*+]\s+)?\**\s*(?:next(?:\s+steps?)?|action(?:\s+item)?|follow[\s-]?up)\s*\**\s*[:\-]\s*([^\n]+)/i
  const m = content.match(re)
  if (!m) return undefined
  const text = m[1]
    .replace(/\*\*/g, '')   // strip bold markers
    .replace(/`/g, '')      // strip code ticks
    .trim()
  return text.length > 0 ? text : undefined
}

export function parsePartnerships(content: string): Partnership[] {
  if (!content.trim()) return []
  // Split on H2 headings (`## Name`). Anything before the first H2 is ignored.
  const lines = content.split('\n')
  const partnerships: Partnership[] = []
  let currentName = ''
  let currentBody: string[] = []

  const flush = () => {
    if (!currentName) return
    const body = currentBody.join('\n').trim()
    partnerships.push({
      name: currentName,
      status: detectStatus(body),
      contacts: extractContacts(body),
      nextAction: extractNextAction(body),
      content: body,
    })
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    if (h2) {
      flush()
      currentName = h2[1].trim()
      currentBody = []
    } else if (currentName) {
      currentBody.push(line)
    }
  }
  flush()
  return partnerships
}

// Wrap bare emails as <a href="mailto:..."> and US-format phones as <a href="tel:...">.
// Skips matches already inside <a>...</a>, markdown link text/url, or angle-bracket autolinks.
const PHONE_REGEX = /(?<![\d/])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g

export function linkifyContacts(content: string): string {
  // Mask regions we should NOT touch: existing markdown links, angle-bracket autolinks, HTML anchors.
  const masks: string[] = []
  const placeholder = (i: number) => ` MASK${i} `
  let masked = content
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (m) => { masks.push(m); return placeholder(masks.length - 1) })
    .replace(/<[^>]+>/g, (m) => { masks.push(m); return placeholder(masks.length - 1) })
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => { masks.push(m); return placeholder(masks.length - 1) })
    .replace(/```[\s\S]*?```/g, (m) => { masks.push(m); return placeholder(masks.length - 1) })
    .replace(/`[^`\n]+`/g, (m) => { masks.push(m); return placeholder(masks.length - 1) })

  masked = masked
    .replace(EMAIL_REGEX, (m) => `<a href="mailto:${m}">${m}</a>`)
    .replace(PHONE_REGEX, (m) => {
      const digits = m.replace(/[^\d+]/g, '')
      const tel = digits.startsWith('+') ? digits : (digits.length === 10 ? `+1${digits}` : `+${digits}`)
      return `<a href="tel:${tel}">${m}</a>`
    })

  return masked.replace(/ MASK(\d+) /g, (_, i) => masks[Number(i)] ?? '')
}
