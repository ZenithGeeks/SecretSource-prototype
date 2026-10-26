/** How strong a paper's venue is, as a small tag in the Scopus results and the paper list
 * (SCRUM-445). Nothing shows when the rank is not known. */

import { Badge } from '../../../components/ui'

const UNRANKED_HINT = 'A conference with no CORE rank on the team’s venue list, or a journal with no CiteScore'

/** `value` is "Q1"-"Q4", "A*"-"C" or "unranked"; `source` says where it comes from, e.g. "CiteScore 2025". */
export function VenueRankBadge({ value, source }: { value: string; source: string }) {
  if (!value) return null
  if (value === 'unranked')
    return (
      <Badge title={UNRANKED_HINT} className="text-ink-muted">
        Venue unranked
      </Badge>
    )
  // Neutral, not green: green means a backed claim everywhere else in the app.
  return (
    <Badge title={`Venue rank ${value}${source ? `, ${source}` : ''}`}>
      {value}
      {source && <span className="font-normal opacity-80">· {source}</span>}
    </Badge>
  )
}
