/** "Citation check": the stacked verdict bar, its legend, the filter chips and the rows.
 * Clicking a row selects it for the Evidence panel below. */

import { Fragment, useState } from 'react'

import { Card, Empty } from '../../../components/ui'
import { checkedLabel } from '../../../lib/author'
import { cn } from '../../../lib/utils'
import { isOpenIssue } from '../../../lib/verdict'
import type { Citation, Draft } from '../../../types/draftCheck'
import { CardHead } from './CardHead'
import { CitationBadge, VerdictBar, VerdictLegend } from './Verdicts'

type Filter = 'needs-work' | 'all' | 'by-section' | 'low-confidence'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'needs-work', label: 'Needs work' },
  { id: 'all', label: 'All' },
  { id: 'by-section', label: 'By section' },
  { id: 'low-confidence', label: 'Low confidence' },
]

/** Below this the check is not sure enough to lean on. */
export const LOW_CONFIDENCE = 0.7

function rowsFor(filter: Filter, citations: Citation[]): Citation[] {
  switch (filter) {
    case 'needs-work':
      return citations.filter(isOpenIssue)
    case 'low-confidence':
      return citations.filter((c) => c.confidence !== undefined && c.confidence < LOW_CONFIDENCE)
    default:
      return citations
  }
}

/** The mono line under a claim: the key, then the confidence or why there is none. */
function rowNote(c: Citation): string {
  const key = `\\cite{${c.key}}`
  if (c.resolution?.kind === 'replaced') return `${key} · replaced ${c.resolution.previousKey}`
  if (c.resolution?.kind === 'overridden') return `${key} · kept, with a note`
  if (c.confidence !== undefined) return `${key} · ${c.confidence.toFixed(2)} confidence`
  if (c.verdict === 'unavailable') return `${key} · source PDF unavailable`
  return `${key} · no bib entry`
}

function CitationRow({ citation, selected, onSelect }: { citation: Citation; selected: boolean; onSelect: () => void }) {
  return (
    <li className="border-b border-border-subtle">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full flex-col items-start gap-1 rounded px-1 py-2 text-left transition-colors hover:bg-accent-soft/40',
          selected && 'bg-accent-soft/60',
        )}
      >
        <CitationBadge verdict={citation.verdict} />
        <span className="text-[13px] text-ink">{citation.claim}</span>
        <span className="font-mono text-[11px] text-ink-muted">{rowNote(citation)}</span>
      </button>
    </li>
  )
}

export function CitationCheckCard({
  draft,
  citations,
  selectedId,
  onSelect,
}: {
  draft: Draft
  citations: Citation[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('needs-work')
  const rows = rowsFor(filter, citations)

  const emptyHint: Record<Filter, [string, string]> = {
    'needs-work': ['Nothing needs work', 'Every checked citation holds up.'],
    all: ['No citations yet', 'Add a \\cite to your draft and re-check.'],
    'by-section': ['No citations yet', 'Add a \\cite to your draft and re-check.'],
    'low-confidence': ['No low-confidence verdicts', `Every verdict is at least ${LOW_CONFIDENCE.toFixed(2)} sure.`],
  }

  // "By section" groups the rows under their section heading, in reading order.
  const sections = filter === 'by-section' ? [...new Set(rows.map((c) => c.section ?? c.file))] : []

  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="citation-check-title">
      <CardHead
        id="citation-check-title"
        title="Citation check"
        aside={
          <span className="text-accent">
            {draft.status.checked} checked · {checkedLabel(draft.lastCheckedAt).replace(/^checked /, '')}
          </span>
        }
      />
      <VerdictBar counts={draft.status.counts} />
      <VerdictLegend counts={draft.status.counts} />

      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'rounded-full px-2.5 py-[3px] text-xs transition-colors',
              filter === f.id ? 'bg-accent-soft font-medium text-accent' : 'bg-canvas text-ink-muted hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty title={emptyHint[filter][0]} hint={emptyHint[filter][1]} />
      ) : filter === 'by-section' ? (
        <ul aria-label="Citations by section">
          {sections.map((section) => (
            <Fragment key={section}>
              <li className="pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{section}</li>
              {rows
                .filter((c) => (c.section ?? c.file) === section)
                .map((c) => (
                  <CitationRow key={c.id} citation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
                ))}
            </Fragment>
          ))}
        </ul>
      ) : (
        <ul aria-label="Citations">
          {rows.map((c) => (
            <CitationRow key={c.id} citation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
          ))}
        </ul>
      )}
    </Card>
  )
}
