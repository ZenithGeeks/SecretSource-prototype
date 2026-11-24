/**
 * How an analysis run is going, at a glance: a step bar, checks done out of the total, what
 * the checks found so far, the checks running now, and the sources that could not be checked,
 * grouped by why. A finished run folds to one line. The full list of steps stays one click
 * away (PipelineStages).
 *
 * Figma: "02 Running" (the panel) and "03 Results" (the finished line).
 */

import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { useNow } from '../lib/timeAgo'

import type { Claim, Stage } from '../lib/api'
import type { Progress, Step, StepState } from '../lib/progress'
import { count, duration, summarise } from '../lib/progress'
import { cn } from '../lib/utils'
import { PipelineStages } from './PipelineStages'
import { TextButton } from './ui'

type Tile = { key: string; label: string; detail: string; state: StepState }

/** The run's five steps, folded into the four the reader sees: the paper is read, then its claims
 * are found, planning and checking are one "match citations", figures and audit one "weigh". */
function tilesOf(progress: Progress, stages: Stage[], running: boolean): Tile[] {
  // summarise always returns all five steps.
  const step = Object.fromEntries(progress.steps.map((item) => [item.key, item])) as Record<string, Step>
  const fold = (...keys: string[]): StepState => {
    const states = keys.map((key) => step[key].state)
    if (states.includes('failed')) return 'failed'
    if (states.includes('current')) return 'current'
    if (states.every((state) => state === 'done' || state === 'skipped')) return 'done'
    return states.includes('done') ? 'current' : 'todo'
  }
  const read = step.read
  const reading: StepState = stages.some((s) => s.stage === 'extracting' || s.stage === 'extracted') ? 'done' : read.state
  let claims: StepState = 'todo'
  if (read.state === 'done') claims = 'done'
  else if (reading === 'done') claims = read.state === 'failed' ? 'failed' : 'current'
  const matching = fold('plan', 'check')
  const weighing = fold('figures', 'audit')
  const found = progress.checksTotal !== null
    ? `${progress.checksDone} of ${progress.checksTotal} found`
    : progress.checksDone ? `${count(progress.checksDone, 'check')} done` : ''
  // A step a stopped run never reached is not waiting for anything.
  const waiting = (state: StepState) => (state !== 'todo' ? '' : running ? 'Waiting' : 'Not run')
  return [
    { key: 'read', label: 'Read the paper', detail: waiting(reading), state: reading },
    { key: 'claims', label: 'Find the claims', detail: read.detail || waiting(claims), state: claims },
    { key: 'match', label: 'Match citations', detail: found || waiting(matching), state: matching },
    { key: 'weigh', label: 'Weigh the evidence', detail: waiting(weighing), state: weighing },
  ]
}

const HEADLINE = ['Reading the paper', 'Finding the claims', 'Matching citations to the cited papers', 'Weighing the evidence']

function StageTile({ tile }: { tile: Tile }) {
  const current = tile.state === 'current'
  return (
    <li className={cn('flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5', current ? 'bg-accent-soft' : 'bg-neutral-soft')}>
      {tile.state === 'done' ? (
        <CheckCircle2 className="size-4 shrink-0 text-supports" aria-hidden="true" />
      ) : current ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
      ) : tile.state === 'failed' ? (
        <AlertCircle className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      ) : (
        <Circle className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className={cn('truncate text-ui leading-4.5 font-medium', current ? 'text-accent' : tile.state === 'todo' ? 'text-ink-muted' : 'text-ink')}>
          {tile.label}
        </p>
        <p className="truncate text-xs leading-4 text-ink-muted">
          {tile.state === 'failed' ? ['Stopped here', tile.detail].filter(Boolean).join(' · ') : tile.detail}
        </p>
      </div>
    </li>
  )
}

function Failures({ progress }: { progress: Progress }) {
  const [open, setOpen] = useState(false)
  if (!progress.failures.length) return null
  const sources = progress.failures.reduce((sum, group) => sum + group.sources.length, 0)
  return (
    <div className="rounded-xl bg-neutral-soft px-3.5 py-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {count(sources, 'source')} couldn&apos;t be checked
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {progress.failures.map((group) => (
            <li key={group.reason} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:gap-3">
              <span className="shrink-0 font-medium text-ink first-letter:uppercase sm:w-56">
                {group.reason} ({group.sources.length})
              </span>
              <span className="text-ink-muted">{group.sources.join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AnalysisProgress({
  stages,
  claims,
  status,
  when = '',
}: {
  stages: Stage[]
  claims: Claim[]
  status: string
  /** "Started 8 Nov 2026, 17:40": which run this is, for a stopped one that has nothing else to tell it by. */
  when?: string
}) {
  const running = status === 'running'
  const [details, setDetails] = useState(false)
  const [allSteps, setAllSteps] = useState(false)
  // In seconds, ticking every second while running, so the elapsed time moves.
  const now = useNow(1000, running) / 1000
  if (!stages.length) return null

  const progress = summarise(stages, claims, status, now)
  const elapsed = progress.seconds !== null ? duration(progress.seconds) : ''
  const checked = progress.checksDone > 0 || progress.checksTotal !== null

  // A finished run is one quiet line; its details open on request.
  if (!running && !details) {
    // Only the total: the per-verdict split counts citations, and next to the tiles below,
    // which count claims, it read as two different answers. Details keep the split.
    const parts = [
      when.replace(/^Started/, 'started'),
      count(progress.claims, 'claim'),
      checked ? `${count(progress.checksDone, 'citation')} checked` : 'sources not checked',
      elapsed,
    ].filter(Boolean)
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-ui text-ink-muted">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* Grey, not red: a stopped run is not a finding, and red means a source contradicts. */}
          {progress.error ? (
            <AlertCircle className="size-4 shrink-0" />
          ) : (
            <CheckCircle2 className="size-4 shrink-0 text-supports" />
          )}
          <span className="font-medium text-ink">
            {progress.error ? 'Stopped' : 'Finished'}
          </span>
          {parts.map((part) => (
            <span key={part} className="flex items-center gap-2">
              <span aria-hidden>·</span>
              {part}
            </span>
          ))}
        </p>
        <TextButton onClick={() => setDetails(true)} aria-expanded={false} className="flex items-center gap-1 text-xs">
          Details
          <ChevronRight className="size-3.5" />
        </TextButton>
      </div>
    )
  }

  const tiles = tilesOf(progress, stages, running)
  const current = tiles.findIndex((tile) => tile.state === 'current' || tile.state === 'failed')
  const done = tiles.filter((tile) => tile.state === 'done').length
  const matchShare = progress.checksTotal ? Math.min(1, progress.checksDone / progress.checksTotal) : 0
  const percent = Math.round(
    ((done + (tiles[2].state === 'current' ? matchShare : 0)) / tiles.length) * 100,
  )
  // A stopped run fills only as far as it got.
  const filled = running || progress.error ? percent : 100

  return (
    <section className="flex flex-col gap-4.5 rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
      <header className="flex items-center gap-2">
        <p className="flex-1 text-reading leading-5 font-semibold" aria-live="polite">
          {running ? HEADLINE[Math.max(0, current)] : progress.error ? 'Stopped' : 'Finished'}
        </p>
        {running ? (
          <p className="text-ui text-ink-muted tabular-nums">{percent}%</p>
        ) : (
          <TextButton onClick={() => setDetails(false)} aria-expanded className="text-xs">
            Hide details
          </TextButton>
        )}
      </header>

      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={filled}
        className="h-1.5 w-full overflow-hidden rounded-sm bg-neutral-soft"
      >
        <div className="h-full rounded-sm bg-accent transition-[width] duration-500" style={{ width: `${filled}%` }} />
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <StageTile key={tile.key} tile={tile} />
        ))}
      </ol>

      {running && (
        <p className="flex items-center gap-2 text-ui text-ink-muted">
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          You can leave this page. We’ll keep going and put the results under Recent analyses.
        </p>
      )}

      {progress.running.length > 0 && (
        <div className="space-y-1.5">
          <p className="type-label text-ink-muted">Now checking</p>
          <ul className="space-y-1">
            {progress.running.map((check) => (
              <li key={`${check.claim}-${check.source}`} className="flex min-w-0 items-center gap-2 text-sm">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
                <span className="shrink-0 font-medium text-ink">Claim {check.claim}</span>
                <span className="truncate text-ink-muted">against {check.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Failures progress={progress} />

      <div className="flex justify-end">
        <TextButton onClick={() => setAllSteps(!allSteps)} aria-expanded={allSteps} className="text-xs">
          {/* The log has a line per event, not per step above, so it is not counted in steps. */}
          {allSteps ? 'Hide the run log' : 'Show the run log'}
        </TextButton>
      </div>
      {allSteps && (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border-subtle p-3">
          <PipelineStages stages={stages} running={running} fold={false} />
        </div>
      )}
    </section>
  )
}
