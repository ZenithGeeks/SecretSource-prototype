/** How strong a paper's venue is: a CiteScore quartile or a CORE rank. The words carry the rank;
 * the colour only groups the strong ones. `label` comes from venueRankLabel or poolVenueRankLabel. */

import { Badge } from '../../../components/ui'

export function VenueRankChip({ label }: { label: string | null }) {
  if (!label) return null
  return (
    <Badge tone={toneOf(label)} title={hint(label)}>
      {label}
    </Badge>
  )
}

function toneOf(label: string): 'supports' | 'accent' | 'insufficient' | 'neutral' {
  if (label.startsWith('Q1 ') || label.startsWith('A* ')) return 'supports'
  if (label.startsWith('Q2 ') || label.startsWith('A ')) return 'accent'
  if (label.startsWith('Q3 ') || label.startsWith('B ')) return 'insufficient'
  return 'neutral'
}

function hint(label: string): string | undefined {
  if (label === 'Rank unavailable') return 'The venue rank could not be looked up'
  if (label === 'Conference, unranked') return 'No CORE rank for this conference'
  if (label.includes('CiteScore')) return 'CiteScore quartile of the journal'
  if (label.includes('CORE')) return 'CORE rank of the conference'
  return undefined
}
