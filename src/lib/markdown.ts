// Markdown utilities - we use react-markdown on the client side
// This file provides server-side helpers for extracting metadata from markdown

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

export function countFlags(content: string): number {
  return (content.match(/\[HUMAN DECISION NEEDED\]/g) || []).length
}

export function extractDeltaIndicators(content: string): { new: number; resolved: number; unchanged: number } {
  const newCount = (content.match(/\*\*NEW\*\*|\[NEW\]|🆕/g) || []).length
  const resolvedCount = (content.match(/\*\*RESOLVED\*\*|\[RESOLVED\]/g) || []).length
  const unchangedCount = (content.match(/\*\*UNCHANGED\*\*|\[UNCHANGED\]|UNCHANGED/g) || []).length
  return { new: newCount, resolved: resolvedCount, unchanged: unchangedCount }
}

export function extractCriticalCount(content: string): number {
  // Count critical/high severity findings in reports
  const criticalMatches = content.match(/\*\*Critical\*\*|\*\*HIGH\*\*|severity:\s*critical|🔴\s*Critical/gi) || []
  return criticalMatches.length
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
