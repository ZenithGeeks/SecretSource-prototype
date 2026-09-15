/**
 * How an analysis run is going, at a glance: a step bar, checks done out of the total, what
 * the checks found so far, the checks running now, and the sources that could not be checked,
 * grouped by why. A finished run folds to one line. The full list of steps stays one click
 * away (PipelineStages).
 *
 * Figma: "02 Running" (the panel) and "03 Results" (the finished line).
 */

import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Claim, Stage } from '../lib/api'
import type { Progress, StepState } from '../lib/progress'
import { duration, summarise } from '../lib/progress'
import { cn } from '../lib/utils'
import { PipelineStages } from './PipelineStages'
import { Card } from './ui'

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The current time, ticking every second while `live`, so the elapsed time moves. */
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [live])
  return now
}

const DOT: Record<StepState, string> = {
  done: 'bg-supports',
  current: 'bg-accent-soft ring-[3px] ring-accent ring-inset',
  todo: 'ring-2 ring-border-subtle ring-inset',
  skipped: 'ring-2 ring-border-subtle ring-inset',
  failed: 'bg-refutes',
}

function Steps({ progress }: { progress: Progress }) {
  return (
    <ol className="grid grid-cols-5 gap-2">
      {progress.steps.map((step, index) => (
        <li key={step.key} className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn('size-3 shrink-0 rounded-full', DOT[step.state])} />
            {index < progress.steps.length - 1 && (
              <span className={cn('h-0.5 flex-1 rounded', step.state === 'done' ? 'bg-supports' : 'bg-border-subtle')} />
            )}
          </div>
          <p
            className={cn(
              'mt-1.5 truncate text-xs',
              step.state === 'current' ? 'font-semibold text-ink' : step.state === 'done' ? 'font-medium text-ink' : 'text-ink-muted',
            )}
          >
            {step.label}
          </p>
          {step.detail && <p className="hidden truncate text-[11px] text-ink-muted sm:block">{step.detail}</p>}
        </li>
      ))}
    </ol>
  )
}

function Counts({ progress }: { progress: Progress }) {
  const chips = [
    { n: progress.verdicts.supports, word: 'backed', className: 'bg-supports-soft text-supports' },
    { n: progress.verdicts.refutes, word: 'contradicted', className: 'bg-refutes-soft text-refutes' },
    { n: progress.verdicts.insufficient, word: 'not enough evidence', className: 'bg-insufficient-soft text-insufficient' },
    { n: progress.failed, word: "couldn't check", className: 'bg-canvas text-ink-muted' },
  ].filter((chip) => chip.n > 0)
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span key={chip.word} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', chip.className)}>
          <span className="font-semibold tabular-nums">{chip.n}</span> {chip.word}
        </span>
      ))}
    </div>
  )
}

function Failures({ progress }: { progress: Progress }) {
  const [open, setOpen] = useState(false)
  if (!progress.failures.length) return null
  const sources = progress.failures.reduce((sum, group) => sum + group.sources.length, 0)
  return (
    <div className="rounded-lg bg-canvas px-3.5 py-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent"
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

export function AnalysisProgress({ stages, claims, status }: { stages: Stage[]; claims: Claim[]; status: string }) {
  const running = status === 'running'
  const [details, setDetails] = useState(false)
  const [allSteps, setAllSteps] = useState(false)
  const now = useNow(running)
  if (!stages.length) return null

  const progress = summarise(stages, claims, status, now)
  const elapsed = progress.seconds !== null ? duration(progress.seconds) : ''
  const checked = progress.checksDone > 0 || progress.checksTotal !== null

  // A finished run is one line; its details open on request.
  if (!running && !details) {
    const parts = [
      count(progress.claims, 'claim'),
      checked ? count(progress.checksDone, 'check') : 'sources not checked',
      progress.verdicts.supports ? `${progress.verdicts.supports} backed` : '',
      progress.verdicts.refutes ? `${progress.verdicts.refutes} contradicted` : '',
      progress.verdicts.insufficient ? `${progress.verdicts.insufficient} not enough evidence` : '',
      progress.failed ? `${progress.failed} couldn't check` : '',
      elapsed,
    ].filter(Boolean)
    return (
      <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          {progress.error ? (
            <AlertCircle className="size-4 shrink-0 text-refutes" />
          ) : (
            <CheckCircle2 className="size-4 shrink-0 text-supports" />
          )}
          <span className={cn('font-semibold', progress.error ? 'text-refutes' : 'text-ink')}>
            {progress.error ? 'Stopped' : 'Finished'}
          </span>
          {parts.map((part) => (
            <span key={part} className="flex items-center gap-2">
              <span aria-hidden>·</span>
              {part}
            </span>
          ))}
        </p>
        <button
          type="button"
          onClick={() => setDetails(true)}
          className="flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Details
          <ChevronRight className="size-3.5" />
        </button>
      </Card>
    )
  }

  return (
    <Card className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink" aria-live="polite">
          {running && <Loader2 className="size-4 animate-spin text-accent" />}
          {running ? 'Analysing' : progress.error ? 'Stopped' : 'Finished'}
        </p>
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          {elapsed && <span>{running ? `${elapsed} so far` : `took ${elapsed}`}</span>}
          {!running && (
            <button type="button" onClick={() => setDetails(false)} className="font-medium text-accent hover:underline">
              Hide details
            </button>
          )}
        </div>
      </header>

      <Steps progress={progress} />

      {checked && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{
                width: progress.checksTotal
                  ? `${Math.min(100, (progress.checksDone / progress.checksTotal) * 100)}%`
                  : '100%',
              }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-ink tabular-nums">
            {progress.checksTotal !== null
              ? `${progress.checksDone} of ${count(progress.checksTotal, 'check')}`
              : `${count(progress.checksDone, 'check')} done`}
          </span>
        </div>
      )}

      <Counts progress={progress} />

      {progress.running.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] leading-4 font-semibold tracking-wide text-ink-muted uppercase">Now checking</p>
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
        <button
          type="button"
          onClick={() => setAllSteps(!allSteps)}
          aria-expanded={allSteps}
          className="rounded text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {allSteps ? 'Hide the steps' : `Show all ${count(stages.length, 'step')}`}
        </button>
      </div>
      {allSteps && (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border-subtle p-3">
          <PipelineStages stages={stages} running={running} fold={false} />
        </div>
      )}
    </Card>
  )
}
