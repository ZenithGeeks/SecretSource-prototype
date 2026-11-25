/**
 * The analysed paper's sections, with how many claims each one makes. Picking one shows that
 * section's claims and opens its page. The section open in the page viewer is marked. The list
 * is one Tab stop, on the marked section, and the arrow keys move along it.
 *
 * Figma: "Table of contents" (TocItem set, and the list under the selected analysis in 03
 * Results and 04 Page viewer). It sits in the History sidebar, above the recent analyses, and
 * knows nothing about the researcher screens, so another role can place it too.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { api } from '../lib/api'
import type { Claim, OutlineEntry } from '../lib/api'
import { standingOf } from '../lib/claims'
import type { Standing } from '../lib/claims'
import type { ContentsRow } from '../lib/outline'
import { contentsRows, shownRow } from '../lib/outline'
import { moveFocus } from '../lib/roving'
import { cn } from '../lib/utils'

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** "5 claims, 1 contradicted": a section's count in words, for its title and screen readers. */
function claimsText(row: ContentsRow) {
  return `${count(row.claims, 'claim')}${row.contradicted ? `, ${row.contradicted} contradicted` : ''}`
}

export function TableOfContents({
  outline,
  claims,
  current,
  filter = null,
  onPick,
}: {
  outline: OutlineEntry[]
  claims: Claim[]
  /** The section of the claim or page open in the page viewer. */
  current: string | null
  /** The standing the claim list is narrowed to: each section counts only those claims. */
  filter?: Standing | null
  onPick: (row: ContentsRow) => void
}) {
  const rows = useMemo(
    () => contentsRows(outline, claims, filter ? claims.filter((claim) => standingOf(claim) === filter) : claims),
    [outline, claims, filter],
  )
  if (!rows.length) return null
  const marked = shownRow(rows, current)

  return (
    <nav aria-label="Contents of this paper" className="pb-2 pl-3">
      <p className="px-3 pt-2 pb-1 text-caption leading-4 font-semibold tracking-wide text-ink-muted uppercase">
        Contents
      </p>
      <ul onKeyDown={(event) => moveFocus(event, 'button', false)}>
        {rows.map((row, index) => (
          <li key={row.n}>
            <button
              type="button"
              data-closes-menu
              onClick={() => onPick(row)}
              aria-current={row.n === marked ? 'location' : undefined}
              tabIndex={row.n === marked || (!marked && index === 0) ? 0 : -1}
              // One clean name; the digits drawn inside would otherwise be read out as "1 Introduction 1 1".
              aria-label={`${row.n} ${row.title}${row.claims ? `, ${claimsText(row)}` : ''}`}
              title={`${row.n} ${row.title}, page ${row.page}${row.claims ? ` · ${claimsText(row)}` : ''}`}
              className={cn(
                'flex min-h-9 w-full items-center gap-2 rounded-r-md border-l-2 py-1 pr-2 text-left text-ui transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                row.depth ? 'pl-6' : 'pl-3',
                row.n === marked
                  ? 'border-accent bg-surface font-medium text-ink'
                  // Under a filter a section without such claims is muted, whatever its level.
                  : cn('border-transparent hover:bg-accent-soft/60', filter && !row.claims ? 'text-ink-muted' : 'text-ink'),
              )}
            >
              <span className="min-w-6 shrink-0 font-mono text-caption text-ink-muted tabular-nums">{row.n}</span>
              <span className="line-clamp-2 min-w-0 flex-1">{row.title}</span>
              {/* A neutral count, and the contradicted ones apart in their own colour, so "5"
                  is never read as five contradictions. */}
              {row.claims > 0 && (
                <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 text-caption leading-4 font-medium tabular-nums">
                  <span className="rounded-full bg-canvas px-1.5 text-ink-muted">{row.claims}</span>
                  {row.contradicted > 0 && (
                    <span className="inline-flex items-center gap-1 text-refutes">
                      <span className="size-1.5 shrink-0 rounded-full bg-refutes" />
                      {row.contradicted}
                    </span>
                  )}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** The table of contents of one analysis, read from the analysis already loaded. It does not
 * follow the run's event stream: AnalysisView does that, and updates the same cached analysis. */
export function AnalysisContents({
  id,
  current,
  filter,
  onPick,
}: {
  id: string
  current: string | null
  filter?: Standing | null
  onPick: (row: ContentsRow) => void
}) {
  const analysis = useQuery({ queryKey: ['analysis', id], queryFn: () => api.getAnalysis(id) })
  if (!analysis.data?.outline?.length) return null
  return (
    <TableOfContents
      outline={analysis.data.outline}
      claims={analysis.data.claims}
      current={current}
      filter={filter}
      onPick={onPick}
    />
  )
}
