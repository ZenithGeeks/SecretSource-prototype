/** The top of an analysis (Figma "Running" and "Results"): a small status label, the paper's title, one meta line. */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Analysis } from '../lib/api'
import { api, paperName } from '../lib/api'
import { duration, summarise } from '../lib/progress'
import { Button } from './ui'

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
function timeAgo(seconds: number) {
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [live])
  return now
}

export function AnalysisHeader({ analysis }: { analysis: Analysis }) {
  const running = analysis.status === 'running'
  const now = useNow(running)
  const times = analysis.stages.map((s) => s.at).filter((at): at is number => typeof at === 'number')
  const progress = summarise(analysis.stages, analysis.claims, analysis.status, now)

  const file = analysis.file ? paperName(analysis.file) : analysis.paper
  const title = analysis.title || file
  const claims = progress.claims

  let label: string
  if (running) label = progress.seconds !== null ? `Analyzing · ${duration(progress.seconds)}` : 'Analyzing'
  else if (analysis.status === 'error') label = 'Stopped'
  else label = times.length ? `Analyzed ${timeAgo(Math.max(0, now - times[times.length - 1]))}` : 'Analyzed'

  const meta = [
    analysis.title ? file : '',
    // The summary line under the header has the check counts; one number per idea.
    running ? '' : `${claims} ${claims === 1 ? 'claim' : 'claims'}`,
  ].filter(Boolean)

  return (
    <header className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="type-label text-accent" aria-live="polite">{label}</p>
        {running && <StopButton id={analysis.id} />}
      </div>
      <h1 className="type-display tracking-[-0.01em]">{title}</h1>
      {meta.length > 0 && <p className="text-[15px] leading-6 text-ink-muted">{meta.join(' · ')}</p>}
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
