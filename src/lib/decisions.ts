/**
 * Decision queue — aggregates every [HUMAN DECISION NEEDED] flag across every
 * bid's markdown files, returning location + context so the Today page can
 * deep-link the user to the exact decision.
 *
 * Built on top of:
 *  - listBids()      → enumerate bids
 *  - getBidDetail()  → already returns all .md files for a bid with content
 *  - iterateFlags()  → from src/lib/markdown.ts; yields { lineNumber, snippet }
 *
 * Deadline-based sorting is deferred to Phase 4.2 (BidStatusData.deadlineProposalDue
 * doesn't exist yet). For now we sort by bid display name then file order.
 */

import { listBids, getBidDetail } from './files'
import { iterateFlags } from './markdown'

export interface DecisionItem {
  bidName: string
  bidDisplayName: string
  fileName: string         // e.g. "response-strategy" (no .md)
  fileDisplayName: string  // e.g. "Response Strategy"
  lineNumber: number
  snippet: string          // ~3 lines of context around the flag
  flagIndex: number        // 1st flag in this file, 2nd, etc.
}

// Flags inside closed bids aren't decisions anymore — they're history.
const CLOSED_STATUSES = new Set(['submitted', 'won', 'lost', 'no-bid'])

export async function getDecisionQueue(): Promise<DecisionItem[]> {
  const bids = (await listBids()).filter(b => !CLOSED_STATUSES.has((b.status || '').toLowerCase()))
  const items: DecisionItem[] = []

  // Walk every bid in parallel; for each bid walk its files.
  await Promise.all(
    bids.map(async (bid) => {
      const detail = await getBidDetail(bid.name)
      if (!detail) return
      for (const file of detail.files) {
        if (file.flagCount === 0) continue
        for (const flag of iterateFlags(file.content)) {
          items.push({
            bidName: bid.name,
            bidDisplayName: bid.displayName,
            fileName: file.name,
            fileDisplayName: file.displayName,
            lineNumber: flag.lineNumber,
            snippet: flag.snippet,
            flagIndex: flag.index,
          })
        }
      }
    })
  )

  // Stable sort: bid name, then file name, then flag index.
  items.sort((a, b) => {
    const byBid = a.bidDisplayName.localeCompare(b.bidDisplayName)
    if (byBid !== 0) return byBid
    const byFile = a.fileName.localeCompare(b.fileName)
    if (byFile !== 0) return byFile
    return a.flagIndex - b.flagIndex
  })

  return items
}
