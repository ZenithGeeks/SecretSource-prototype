/** How strong a paper's venue is, as a small tag in the Scopus results and the paper list
 * (SCRUM-445). Nothing shows when the rank is not known. */

import { Badge } from '../../../components/ui'

const UNRANKED_HINT = 'A conference with no CORE rank on the team’s venue list, or a journal with no CiteScore'

/** The words on the chip. CiteScore keeps its year ("CiteScore 2025"). CORE is the system name. */
function sourceLabel(source: string): string {
  if (source.startsWith('CORE')) return 'CORE'
  return source
}

/** `value` is "Q1"-"Q4", "A*"-"C" or "unranked"; `source` is "CiteScore 2025" or "CORE 2026".
 * A failed lookup is a separate chip: pass `unavailable`. */
export function VenueRankBadge({ value, source = '', unavailable = false }: { value?: string; source?: string; unavailable?: boolean }) {
  if (unavailable)
    return (
      <Badge title="The venue rank could not be looked up" className="text-ink-muted">
        Rank unavailable
      </Badge>
    )
  if (!value) return null
  if (value === 'unranked')
    return (
      <Badge title={UNRANKED_HINT} className="text-ink-muted">
        Conference, unranked
      </Badge>
    )
  const label = sourceLabel(source)
  // Neutral, not green: green means a backed claim everywhere else in the app.
  return (
    <Badge title={`Venue rank ${value}${source ? `, ${source}` : ''}`}>
      {value}
      {label && <span className="font-normal opacity-80"> · {label}</span>}
    </Badge>
  )
}
