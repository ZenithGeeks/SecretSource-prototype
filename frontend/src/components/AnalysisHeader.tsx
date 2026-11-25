/** The top of an analysis (Figma "Running" and "Results"): the paper's title, then one meta line
 * that ends with how the run is going. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Square } from 'lucide-react'

import type { Analysis } from '../lib/api'
import { api } from '../lib/api'
import { analysisLabel } from '../lib/claims'
import { duration, summarise } from '../lib/progress'
import { timeAgo, useNow } from '../lib/timeAgo'
import { HELP_ID } from './StandingKey'
import { Button, TextButton } from './ui'

/** Opens the key under an analysis's tiles and moves to it. */
function openHelp() {
  const help = document.getElementById(HELP_ID)
  if (!(help instanceof HTMLDetailsElement)) return
  help.open = true
  help.scrollIntoView({ block: 'center' })
  help.querySelector('summary')?.focus()
}

export function AnalysisHeader({ analysis }: { analysis: Analysis }) {
  const running = analysis.status === 'running'
  const now = useNow(1000, running) / 1000 // seconds
  const times = analysis.stages.map((s) => s.at).filter((at): at is number => typeof at === 'number')
  const progress = summarise(analysis.stages, analysis.claims, analysis.status, now)

  // A run stopped before the paper was read has no title; another run of the same paper may.
  // The sidebar's list, read without fetching; it re-renders this when the list arrives.
  const runs = useQuery({ queryKey: ['analyses'], queryFn: api.listAnalyses, enabled: false }).data
  const title = analysisLabel(analysis, runs)
  // The authors and year too, so a stopped run's meta line matches the finished run's.
  const named = (!analysis.authors?.length && runs?.find((run) => run.authors?.length && analysisLabel(run) === title)) || analysis
  const authors = named.authors ?? []

  // A stopped run says so in the progress line below, so it gets no status here.
  let status = ''
  if (running) status = progress.seconds !== null ? `Analyzing · ${duration(progress.seconds)}` : 'Analyzing'
  else if (analysis.status === 'done') status = times.length ? `Analyzed ${timeAgo(Math.max(0, now - times[times.length - 1]))}` : 'Analyzed'

  // Who wrote it, not the stored file name. The claim count is on the summary line below.
  const meta = [
    authors.length ? `${authors[0]}${authors.length > 1 ? ' et al.' : ''}` : '',
    named.year ?? '',
    !analysis.title && !authors.length && title !== analysis.paper ? analysis.paper : '',
    status,
  ].filter(Boolean)

  return (
    <header className="flex flex-col gap-2">
      <h1 className="type-display tracking-[-0.01em]">{title}</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {meta.length > 0 && <p className="text-reading leading-6 text-ink-muted">{meta.join(' · ')}</p>}
        {running && <StopButton id={analysis.id} />}
        {/* The key and "How to read this page" sit under the tiles, which a finished run with claims has. */}
        {analysis.status === 'done' && analysis.claims.length > 0 && (
          <TextButton onClick={openHelp} className="text-ui">
            Help
          </TextButton>
        )}
      </div>
    </header>
  )
}

/** Stops a queued or running analysis. A running one ends after its current step, so the button waits for that. */
function StopButton({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const stop = useMutation({
    mutationFn: () => api.stopAnalysis(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis', id] })
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
    },
  })
  // After success the header stays until the stream brings the error stage, which unmounts this.
  const stopping = stop.isPending || stop.isSuccess
  return (
    <div className="flex items-center gap-2">
      {stop.isError && <span role="alert" className="text-xs text-refutes">{(stop.error as Error).message}</span>}
      <Button variant="ghost" className="h-8 px-3 text-xs" disabled={stopping} onClick={() => stop.mutate()}>
        <Square className="size-3" aria-hidden="true" />
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
    </div>
  )
}
