/** Recent analyses in the sidebar: a "Recent analyses" label with "+ New", then one row per
 * analysis (dot by its worst verdict, file name, claim count or an em dash). Selecting one
 * reopens its results; deleting one removes it for good. */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { api, type Analysis } from '../lib/api'
import { analysisLabel, standingOf, STANDINGS, type Standing } from '../lib/claims'
import { cn } from '../lib/utils'

const DOT: Record<Standing, string> = {
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
  supports: 'bg-supports',
  unchecked: 'bg-neutral',
  named: 'bg-neutral',
  uncited: 'bg-neutral',
}

/** The worst standing among an analysis's claims; null while running or when it has none. */
function worstStanding(analysis: Analysis): Standing | null {
  if (analysis.status !== 'done' || !analysis.claims.length) return null
  return analysis.claims.map(standingOf).sort((a, b) => STANDINGS.indexOf(a) - STANDINGS.indexOf(b))[0]
}

export function HistoryList({
  analyses,
  selected,
  onSelect,
  onNew,
  contents,
}: {
  analyses: Analysis[]
  selected: string | null
  onSelect: (id: string | null) => void
  /** Starts a new analysis; the "+ New" link shows only when given. */
  onNew?: () => void
  /** Shown under the selected analysis, e.g. its table of contents. */
  contents?: ReactNode
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: api.deleteAnalysis,
    onSuccess: ({ deleted }) => {
      if (deleted === selected) onSelect(null)
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
    },
  })

  const header = (
    <div className="flex items-center px-2.5 pb-1.5">
      <p className="type-label text-ink-muted">Recent analyses</p>
      <span className="flex-1" />
      {onNew && (
        <button
          type="button"
          data-closes-menu
          onClick={onNew}
          className="text-xs font-medium text-accent hover:underline"
        >
          + New
        </button>
      )}
    </div>
  )

  if (!analyses.length) {
    return (
      <section aria-label="Recent analyses">
        {header}
        <p className="px-2.5 text-[13px] text-ink-muted">No analyses yet.</p>
      </section>
    )
  }

  return (
    <section aria-label="Recent analyses">
      {header}
      <nav aria-label="Analyses" className="space-y-0.5">
        {analyses.map((analysis) => {
          const name = analysisLabel(analysis)
          const standing = worstStanding(analysis)
          const isSelected = analysis.id === selected
          return (
            <Fragment key={analysis.id}>
              <div
                className={cn(
                  'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                  isSelected ? 'bg-accent-soft' : 'hover:bg-accent-soft/60',
                )}
              >
                <button
                  data-closes-menu
                  onClick={() => onSelect(analysis.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    'flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13px] leading-[18px] font-medium lg:min-h-8',
                    isSelected ? 'text-accent' : 'text-ink',
                  )}
                  title={name}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      analysis.status === 'running' ? 'animate-pulse bg-accent' : DOT[standing ?? 'unchecked'],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {analysis.status === 'error' && <span className="text-refutes">!</span>}
                  <span className="shrink-0 text-xs font-normal text-ink-muted">
                    {analysis.status === 'done' && analysis.claims.length ? analysis.claims.length : '—'}
                  </span>
                </button>
                <button
                  onClick={() => remove.mutate(analysis.id)}
                  aria-label={`Delete analysis of ${name}`}
                  className="grid size-8 shrink-0 place-items-center rounded text-ink-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-refutes max-lg:size-11 max-lg:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {isSelected && contents}
            </Fragment>
          )
        })}
      </nav>
    </section>
  )
}
