/** Every analysis the researcher has run, by paper title, with a search box: the Analyses
 * screen's list. The sidebar keeps the recent ones; this is where an older one is found.
 * One row per paper; its other runs, stopped ones included, fold under that row. */

import { Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { StandingCounts, StandingKey } from '../../../components/StandingKey'
import { FacetFilter } from '../../../components/FacetFilter'
import { Badge, Input } from '../../../components/ui'
import { analysisFailure } from '../../../lib/analysisError'
import type { Analysis } from '../../../lib/api'
import {
  analysisLabel,
  byRunTime,
  countsOf,
  countsText,
  groupRuns,
  ranked,
  runTime,
  STANDING_LABELS,
  STANDINGS,
  standingOf,
  standingsIn,
} from '../../../lib/claims'
import type { Standing } from '../../../lib/claims'

/** A run's state when it has no counts to show. A stopped run is grey, not red: red is for a
 * source that contradicts a claim. */
function RunState({ analysis }: { analysis: Analysis }) {
  if (analysis.status === 'running') return <Badge tone="accent">Running</Badge>
  if (analysis.status === 'error') return <Badge>Stopped</Badge>
  if (!analysis.claims.length) return <Badge>No claims</Badge>
  return null
}

/** "Finished 12 Nov 2026, 14:05 · 20 claims": what tells two runs of one paper apart. */
function runDetails(analysis: Analysis) {
  const count = analysis.claims.length
  const claims = analysis.status === 'done' ? `${count} ${count === 1 ? 'claim' : 'claims'}` : ''
  return [runTime(analysis), claims].filter(Boolean).join(' · ')
}

/** The search, filter, open earlier-runs groups and scroll a reader leaves the list with, kept
 * in its history entry so Back from an analysis finds the list as it was. */
type ListState = { query: string; shows: Standing[]; openGroups: string[]; scrollY: number }

function savedState(): ListState | undefined {
  return (window.history.state as { analysisList?: ListState } | null)?.analysisList
}

/** Puts the filter in the address, so a reload or a shared link keeps it. */
function writeStandingParam(shows: Standing[]) {
  const params = new URLSearchParams(window.location.search)
  if (shows.length) params.set('standing', shows.join(','))
  else params.delete('standing')
  window.history.replaceState(window.history.state, '', `?${params}`)
}

/** Whether a paper's run has a claim with this standing. */
function has(analysis: Analysis, standing: Standing) {
  return analysis.status === 'done' && analysis.claims.some((claim) => standingOf(claim) === standing)
}

const CLEAR_BUTTON = 'rounded-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent'

export function AnalysisList({ analyses, onOpen }: { analyses: Analysis[]; onOpen: (id: string) => void }) {
  const [saved] = useState(savedState)
  const [query, setQuery] = useState(saved?.query ?? '')
  const [picked, setPicked] = useState<Standing[]>(
    () => saved?.shows ?? standingsIn(new URLSearchParams(window.location.search).get('standing')),
  )
  const [openGroups, setOpenGroups] = useState<string[]>(saved?.openGroups ?? [])
  // Back from an analysis returns to where the reader was; anything else starts at the top.
  useEffect(() => {
    window.scrollTo(0, saved?.scrollY ?? 0)
  }, [saved])
  const open = (id: string) => {
    const state: ListState = { query, shows: picked, openGroups, scrollY: window.scrollY }
    window.history.replaceState({ ...window.history.state, analysisList: state }, '')
    onOpen(id)
  }
  const pick = (next: Standing[]) => {
    setPicked(next)
    writeStandingParam(next)
  }
  // Every standing some paper has: the same set an analysis's tiles offer.
  const runs = groupRuns(analyses).map(({ run }) => run)
  const kinds = STANDINGS.filter((kind) => runs.some((run) => has(run, kind)))
  // A standing whose last paper was deleted has no option left, so it stops filtering.
  const shows = picked.filter((kind) => kinds.includes(kind))
  const searchId = useId()
  const words = query.trim().toLowerCase()
  const shown = words
    ? analyses.filter((analysis) => `${analysisLabel(analysis)} ${analysis.paper}`.toLowerCase().includes(words))
    : analyses
  const papers = groupRuns([...shown].sort(byRunTime))
    .filter(({ run }) => !shows.length || shows.some((kind) => has(run, kind)))
    .sort((a, b) => byRunTime(a.run, b.run))

  return (
    <section aria-labelledby={`${searchId}-title`} className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${searchId}-title`} className="type-title flex-1">
          Your analyses
        </h2>
        <label htmlFor={searchId} className="sr-only">
          Search your analyses
        </label>
        {kinds.length > 0 && (
          <FacetFilter
            label="Has a claim"
            options={kinds.map((kind) => ({
              value: kind,
              label: STANDING_LABELS[kind],
              count: runs.filter((run) => has(run, kind)).length,
            }))}
            selected={shows}
            onChange={(next) => pick(standingsIn(next.join(',')))}
          />
        )}
        <div className="relative w-full sm:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title or DOI"
            className="pl-9"
          />
        </div>
      </div>
      <StandingKey />
      {/* Read out as the search narrows the list. */}
      <p aria-live="polite" className="sr-only">
        {words ? `${shown.length} of ${analyses.length} analyses` : ''}
      </p>
      {papers.length ? (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface">
          {papers.map(({ run, earlier }) => (
            <li key={run.id}>
              <RunRow analysis={run} label={analysisLabel(run, earlier)} onOpen={open} />
              {earlier.length > 0 && (
                <details
                  open={openGroups.includes(run.id)}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open
                    setOpenGroups((ids) => (isOpen ? [...new Set([...ids, run.id])] : ids.filter((id) => id !== run.id)))
                  }}
                  className="pb-2"
                >
                  <summary className="ml-2 min-h-8 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-accent-soft/60">
                    {earlier.length} earlier {earlier.length === 1 ? 'run' : 'runs'}
                  </summary>
                  <ul className="ml-4 border-l border-border-subtle">
                    {earlier.map((analysis) => (
                      <li key={analysis.id}>
                        {/* Under its paper's row, the date is the name, lighter than the newest run's. */}
                        <RunRow analysis={analysis} label={runDetails(analysis) || analysisLabel(analysis)} earlier onOpen={open} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        // Every option has a paper behind it, so only a search can leave the list empty.
        <p className="text-ui text-ink-muted">
          No analysis matches “{query.trim()}”
          {shows.length > 0 && ` with ${shows.map((kind) => STANDING_LABELS[kind]).join(' or ')}`} ·{' '}
          <button type="button" onClick={() => setQuery('')} className={CLEAR_BUTTON}>
            Clear search
          </button>
          {shows.length > 0 && (
            <>
              {' · '}
              <button type="button" onClick={() => pick([])} className={CLEAR_BUTTON}>
                Clear filter
              </button>
            </>
          )}
        </p>
      )}
    </section>
  )
}

function RunRow({
  analysis,
  label,
  earlier = false,
  onOpen,
}: {
  analysis: Analysis
  label: string
  /** An earlier run under its paper's row. */
  earlier?: boolean
  onOpen: (id: string) => void
}) {
  const details = runDetails(analysis)
  const counted = analysis.status === 'done' && analysis.claims.length > 0
  return (
    <button
      type="button"
      onClick={() => onOpen(analysis.id)}
      // The full split, which the row cuts to the worst three.
      title={counted ? countsText(analysis.claims) : undefined}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-ui hover:bg-accent-soft/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={earlier ? 'text-xs text-ink-muted' : 'line-clamp-2 font-medium text-ink'}>{label}</span>
        {details && details !== label && <span className="text-xs text-ink">{details}</span>}
        {/* The list has the run's error but not its steps, so the reason only. */}
        {analysis.status === 'error' && <span className="text-xs text-ink-muted">{analysisFailure(analysis.message).text}</span>}
        {/* On a line of their own, so they never cut the title short. */}
        {counted && <StandingCounts counts={countsOf(ranked(analysis.claims))} limit={3} />}
      </span>
      <RunState analysis={analysis} />
    </button>
  )
}
