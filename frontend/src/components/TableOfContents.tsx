/**
 * The analysed paper's sections, with how many claims each one makes. Picking one shows that
 * section's claims and opens its page. The section open in the page viewer is marked.
 *
 * Figma: "Table of contents" (TocItem set, and the list under the selected analysis in 03
 * Results and 04 Page viewer). It sits in the History sidebar, directly under the analysis it
 * belongs to, and knows nothing about the researcher screens, so another role can place it too.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { api } from '../lib/api'
import type { Claim, OutlineEntry } from '../lib/api'
import type { ContentsRow } from '../lib/outline'
import { contentsRows, shownRow } from '../lib/outline'
import { cn } from '../lib/utils'

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export function TableOfContents({
  outline,
  claims,
  current,
  onPick,
}: {
  outline: OutlineEntry[]
  claims: Claim[]
  /** The section of the claim or page open in the page viewer. */
  current: string | null
  onPick: (row: ContentsRow) => void
}) {
  const rows = useMemo(() => contentsRows(outline, claims), [outline, claims])
  if (!rows.length) return null
  const marked = shownRow(rows, current)

  return (
    <nav aria-label="Contents of this paper" className="pb-2 pl-3">
      <p className="px-3 pt-2 pb-1 text-[11px] leading-4 font-semibold tracking-wide text-ink-muted uppercase">
        Contents
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.n}>
            <button
              type="button"
              data-closes-menu
              onClick={() => onPick(row)}
              aria-current={row.n === marked ? 'location' : undefined}
              title={`${row.n} ${row.title}, page ${row.page}`}
              className={cn(
                'flex min-h-9 w-full items-center gap-2 rounded-r-md border-l-2 pr-2 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                row.depth ? 'pl-6' : 'pl-3',
                row.n === marked
                  ? 'border-accent bg-surface font-medium text-ink'
                  : 'border-transparent text-ink hover:bg-accent-soft/60',
              )}
            >
              <span className="min-w-6 shrink-0 font-mono text-[11px] text-ink-muted tabular-nums">{row.n}</span>
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              {row.claims > 0 && (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-[11px] leading-4 font-medium tabular-nums',
                    row.contradicted ? 'bg-refutes-soft text-refutes' : 'bg-canvas text-ink-muted',
                  )}
                  title={`${count(row.claims, 'claim')} from this section${row.contradicted ? ', contradicted by a source' : ''}`}
                >
                  {row.claims}
                </span>
              )}
              <span className="w-5 shrink-0 text-right text-[11px] text-ink-muted tabular-nums">{row.page}</span>
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
  onPick,
}: {
  id: string
  current: string | null
  onPick: (row: ContentsRow) => void
}) {
  const analysis = useQuery({ queryKey: ['analysis', id], queryFn: () => api.getAnalysis(id) })
  if (!analysis.data?.outline?.length) return null
  return (
    <TableOfContents
      outline={analysis.data.outline}
      claims={analysis.data.claims}
      current={current}
      onPick={onPick}
    />
  )
}
