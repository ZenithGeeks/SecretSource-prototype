/** Recent analyses in the sidebar: a "Recent analyses" label with "+ New", then one row per
 * paper (paper title, claim count and how many a source contradicts), newest first like the
 * Analyses list. The open paper's row stays in its place, highlighted, with its table of
 * contents under it, and is scrolled into view when it opens. Selecting one reopens its
 * results. The rows are one Tab stop; the arrow keys move between them. Deleting one (its button,
 * or the Delete key on the row) hides it at once and removes it for good after a few seconds,
 * unless the reader undoes it from the toast. */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { api, type Analysis } from '../lib/api'
import { askTarget } from '../lib/askCursor'
import { analysisLabel, byRunTime, claimsLine, countsText, groupRuns, type PaperRuns } from '../lib/claims'
import { moveFocus } from '../lib/roving'
import { cn } from '../lib/utils'
import { TextButton } from './ui'

/** How long a deleted analysis can still be brought back. */
export const UNDO_DELETE_MS = 6000

const ROW = '[data-history-row]'

/** The line under a row's title, the same shape on every row: "20 claims", then
 * ", 3 contradicted by a source" only when a source does. The full split is on hover. */
function rowDetail(analysis: Analysis) {
  if (analysis.status === 'running') return 'Running'
  if (analysis.status === 'error') return 'Stopped'
  if (!analysis.claims.length) return 'No claims'
  return claimsLine(analysis.claims)
}

/** The open paper's row, when the run open is not the one the row counts: "Viewing an earlier
 * run · stopped", so the row's numbers are not read as the open page's. */
function otherRunDetail(row: Analysis, opened: Analysis, analyses: Analysis[]) {
  const newer = analyses.indexOf(opened) < analyses.indexOf(row)
  const state = opened.status === 'error' ? 'stopped' : opened.status === 'running' ? 'running' : 'finished'
  return `Viewing ${newer ? 'a later' : 'an earlier'} run · ${state}`
}

export function HistoryList({
  analyses,
  selected,
  onSelect,
  onNew,
  contents,
  loading = false,
}: {
  analyses: Analysis[]
  selected: string | null
  onSelect: (id: string | null) => void
  /** Starts a new analysis; the "+ New" link shows only when given. */
  onNew?: () => void
  /** Shown under the selected analysis, e.g. its table of contents. */
  contents?: ReactNode
  /** The list is still being fetched, so an empty list is not "no analyses". */
  loading?: boolean
}) {
  const queryClient = useQueryClient()
  // Rows waiting out the undo window: hidden here, not yet deleted on the server.
  const [hidden, setHidden] = useState<string[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const remove = useMutation({
    mutationFn: api.deleteAnalysis,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analyses'] }),
    onError: (_error, id) => {
      setHidden((ids) => ids.filter((hiddenId) => hiddenId !== id))
      toast.error('Could not delete that analysis. It is back in the list.')
    },
  })

  // Leaving the screen ends the undo window: send the deletes that were waiting. Straight to
  // the API, since this component's mutation goes away with it. A failed one has no screen left
  // to report on; the refetch shows the row again, so nothing is lost silently.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer)
        api
          .deleteAnalysis(id)
          .catch(() => undefined)
          .finally(() => queryClient.invalidateQueries({ queryKey: ['analyses'] }))
      }
    }
  }, [queryClient])

  const deleteLater = (analysis: Analysis) => {
    if (analysis.id === selected) onSelect(null)
    setHidden((ids) => [...ids, analysis.id])
    const timer = setTimeout(() => {
      timers.current.delete(analysis.id)
      remove.mutate(analysis.id)
    }, UNDO_DELETE_MS)
    timers.current.set(analysis.id, timer)
    toast(`Deleted “${analysisLabel(analysis)}”`, {
      duration: UNDO_DELETE_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timers.current.get(analysis.id))
          timers.current.delete(analysis.id)
          setHidden((ids) => ids.filter((id) => id !== analysis.id))
        },
      },
    })
  }
  const shown = analyses.filter((analysis) => !hidden.includes(analysis.id))

  // The open paper keeps its place in the order, so its row is brought into view instead.
  const list = useRef<HTMLElement>(null)
  const hasRows = shown.length > 0
  useEffect(() => {
    if (hasRows) list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, hasRows])

  const header = (
    <div className="flex items-center px-2.5 pb-1.5">
      <p className="type-label text-ink-muted">Recent analyses</p>
      <span className="flex-1" />
      {onNew && (
        <TextButton data-closes-menu onClick={onNew} className="text-xs">
          + New
        </TextButton>
      )}
    </div>
  )

  if (!shown.length) {
    return (
      <section aria-label="Recent analyses">
        {header}
        <p className="px-2.5 text-ui text-ink-muted">{loading ? 'Loading…' : 'No analyses yet.'}</p>
      </section>
    )
  }

  // One row per paper, opening its newest finished run. An older run of it, opened from the
  // Analyses screen, still marks that row as the current one. The other runs are listed there.
  const papers = groupRuns([...shown].sort(byRunTime)).sort((a, b) => byRunTime(a.run, b.run))
  const open = papers.find(({ run, earlier }) => run.id === selected || earlier.some((other) => other.id === selected))

  const row = (paper: PaperRuns) => {
    const { run: analysis, earlier } = paper
    const name = analysisLabel(analysis, earlier)
    const isSelected = paper === open
    const opened = isSelected ? earlier.find((other) => other.id === selected) : undefined
    // One Tab stop for the list: the open paper's row, else the first.
    const isTabStop = open ? isSelected : paper === papers[0]
    const counts = analysis.status === 'done' ? countsText(analysis.claims) : ''
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
            onKeyDown={(event) => {
              // Only a plain Delete on the row itself: never one meant for something inside it.
              const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
              if (event.key === 'Delete' && event.target === event.currentTarget && !modified) deleteLater(analysis)
            }}
            aria-keyshortcuts="Delete"
            aria-current={isSelected ? 'true' : undefined}
            data-history-row
            tabIndex={isTabStop ? 0 : -1}
            data-ask-target={askTarget({ kind: 'paper', id: analysis.id })}
            className={cn(
              'flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1 text-left text-ui leading-5 font-medium lg:min-h-8',
              isSelected ? 'text-accent' : 'text-ink',
            )}
            title={counts ? `${name}
${counts}` : name}
          >
            <span className="min-w-0 flex-1">
              {/* Wrapped at words and cut after two lines; the full title is on hover. */}
              <span className="line-clamp-2">{name}</span>
              <span className="block text-xs font-normal text-ink-muted">
                {opened ? otherRunDetail(analysis, opened, shown) : rowDetail(analysis)}
              </span>
            </span>
          </button>
          {/* Out of the Tab order, which is one stop for the whole list: the Delete key on a
              row does the same. */}
          <button
            tabIndex={-1}
            onClick={() => deleteLater(analysis)}
            aria-label={`Delete analysis of ${name}`}
            className="grid size-8 shrink-0 place-items-center rounded-sm text-ink-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-refutes max-lg:size-11 max-lg:opacity-100"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        {isSelected && contents}
      </Fragment>
    )
  }

  return (
    <section aria-label="Recent analyses">
      {header}
      {/* The open paper's contents sit inside the list with keys of their own, so only a key
          pressed on a row moves between rows. */}
      <nav
        ref={list}
        aria-label="Analyses"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.matches(ROW)) moveFocus(event, ROW, false)
        }}
        className="space-y-0.5"
      >
        {papers.map(row)}
      </nav>
    </section>
  )
}
