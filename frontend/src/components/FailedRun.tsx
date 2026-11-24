/** A stopped or failed analysis: what happened in plain words, a way to run it again (or to open
 * a later run of the paper that finished), and the raw error behind "Technical details" for
 * whoever has to debug it. */

import { useMutation, useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { useId } from 'react'

import { api, type Analysis } from '../lib/api'
import { analysisFailure } from '../lib/analysisError'
import { groupRuns, runTime } from '../lib/claims'
import { OFFLINE_REASON, useFeature } from '../lib/features'
import { Button } from './ui'

/** An uploaded paper is stored as a server path, which cannot be sent back as a new request. */
const restartable = (paper: string) => !paper.toLowerCase().endsWith('.pdf')

/** The newest finished run of the same paper that started after this one, from a newest-first list. */
function laterFinishedRun(analysis: Analysis, analyses: Analysis[]) {
  const paper = groupRuns(analyses).find(
    ({ run, earlier }) => run.id === analysis.id || earlier.some((other) => other.id === analysis.id),
  )
  if (!paper) return undefined
  const runs = [paper.run, ...paper.earlier]
  const newer = analyses.slice(0, analyses.findIndex((run) => run.id === analysis.id))
  return newer.find((run) => run.status === 'done' && runs.includes(run))
}

export function FailedRun({ analysis, onOpen }: { analysis: Analysis; onOpen?: (id: string) => void }) {
  const failure = analysisFailure(analysis.message)
  // The sidebar's list, read without fetching; it re-renders this when the list arrives.
  const runs = useQuery({ queryKey: ['analyses'], queryFn: api.listAnalyses, enabled: false }).data ?? []
  const retry = useMutation({
    mutationFn: () => api.startAnalysis(analysis.paper, true),
    onSuccess: ({ id }) => onOpen?.(id),
  })
  const canRetry = failure.retry && Boolean(onOpen) && restartable(analysis.paper)
  const online = useFeature('analyses')
  const later = onOpen && laterFinishedRun(analysis, runs)
  // One message per state: a finished later run makes retry advice beside it noise, and an
  // offline server makes "try again in a few minutes" a promise nobody keeps.
  const advice = canRetry && !later && online ? failure.advice : ''

  const reasonId = useId()
  // Why "Run it again" is off, or what it costs, as text beside it: a disabled button shows no tooltip.
  const retryNote = retry.isError
    ? `Could not start it: ${(retry.error as Error).message}`
    : !online
      ? OFFLINE_REASON.analyses
      : later
        ? ''
        : 'Runs the whole paper again: about 4 minutes, on the team’s LLM budget.'

  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-neutral-soft px-5 py-4 text-sm">
      <p className="font-medium text-ink">{advice ? `${failure.text} ${advice}` : failure.text}</p>
      {(later || canRetry) && (
        <div className="flex flex-wrap items-center gap-3">
          {later && <Button onClick={() => onOpen(later.id)}>Open the finished run</Button>}
          {/* The same words the Analyses list dates that run by. */}
          {later && <span className="text-ink-muted">{runTime(later)}</span>}
          {canRetry && (
            <Button
              variant={later ? 'ghost' : 'solid'}
              disabled={!online || retry.isPending}
              aria-describedby={retryNote ? reasonId : undefined}
              onClick={() => retry.mutate()}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {retry.isPending ? 'Starting…' : 'Run it again'}
            </Button>
          )}
          {canRetry && retryNote && (
            <span id={reasonId} className={retry.isError ? 'text-refutes' : 'text-ink-muted'}>
              {retryNote}
            </span>
          )}
        </div>
      )}
      {!canRetry && !restartable(analysis.paper) && <p className="text-ink-muted">Upload the PDF again to run a new check.</p>}
      {failure.details && failure.details !== failure.text && (
        <details className="text-ink-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-2 font-mono text-xs break-all">{failure.details}</p>
        </details>
      )}
    </div>
  )
}
