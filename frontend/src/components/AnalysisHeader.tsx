/** The top of an analysis (Figma "Running" and "Results"): a small status label, the paper's title, one meta line. */

import { useEffect, useState } from 'react'

import type { Analysis } from '../lib/api'
import { paperName } from '../lib/api'
import { duration, summarise } from '../lib/progress'

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
  const checked = progress.verdicts.supports + progress.verdicts.refutes + progress.verdicts.insufficient

  let label: string
  if (running) label = progress.seconds !== null ? `Analyzing · ${duration(progress.seconds)}` : 'Analyzing'
  else if (analysis.status === 'error') label = 'Stopped'
  else label = times.length ? `Analyzed ${timeAgo(Math.max(0, now - times[times.length - 1]))}` : 'Analyzed'

  const meta = [
    analysis.title ? file : '',
    running ? '' : `${claims} ${claims === 1 ? 'claim' : 'claims'}${checked ? `, ${checked} ${checked === 1 ? 'citation' : 'citations'} checked` : ''}`,
  ].filter(Boolean)

  return (
    <header className="flex flex-col gap-2">
      <p className="type-label text-accent" aria-live="polite">{label}</p>
      <h1 className="type-display tracking-[-0.01em]">{title}</h1>
      {meta.length > 0 && <p className="text-[15px] leading-6 text-ink-muted">{meta.join(' · ')}</p>}
    </header>
  )
}
