/**
 * Paper detail — opened from a library row (or a graph link). Shows the paper's metadata, a
 * claim tally, and each claim with its verdict badge + the passage its cited source relied on.
 * Data via useResearcherPaper (mock-backed). "Show in the paper" is where the PDF page viewer
 * will hook in once the gateway serves pages.
 */

import { RefreshCw } from 'lucide-react'

import { Button, VerdictBadge } from '../../../components/ui'
import { useResearcherPaper } from '../../../lib/useResearcher'

export function PaperDetail({
  projectId,
  paperId,
  projectName,
  onBack,
}: {
  projectId: string
  paperId: string
  projectName: string
  onBack: () => void
}) {
  const paper = useResearcherPaper(projectId, paperId).data
  if (!paper) return null
  const t = paper.tally

  const stats: { value: number; label: string; className: string }[] = [
    { value: t.claims, label: 'claims', className: 'text-ink' },
    { value: t.backed, label: 'backed', className: 'text-supports' },
    { value: t.contradicted, label: 'contradicted', className: 'text-refutes' },
    { value: t.silent, label: 'silent', className: 'text-insufficient' },
  ]

  return (
    <>
      <button type="button" onClick={onBack} className="self-start text-[13px]">
        <span className="font-medium text-accent hover:underline">← Library</span>
        <span className="text-ink-muted"> · {projectName}</span>
      </button>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-ink">
            {paper.title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">{paper.cite}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="size-2 rounded-full bg-accent" />
            {paper.cluster}
            {paper.linked.length > 0 && <> · linked to {paper.linked.join(', ')}</>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost">Open PDF</Button>
          <Button>
            <RefreshCw className="size-4" />
            Re-check
          </Button>
        </div>
      </header>

      {/* tally */}
      <div className="flex gap-6 rounded-xl border border-border-subtle bg-surface px-5 py-3.5">
        {stats.map((s) => (
          <div key={s.label}>
            <p className={`font-serif text-xl font-semibold ${s.className}`}>{s.value}</p>
            <p className="text-xs text-ink-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold text-ink">Claims in this paper</h2>
      <div className="flex flex-col gap-3">
        {paper.claimsDetail.map((c, i) => (
          <div key={i} className="rounded-xl border border-border-subtle bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15px] font-medium text-ink">{c.claim}</p>
              <VerdictBadge verdict={c.verdict} />
            </div>
            <p className="mt-2 font-serif text-[13px] italic text-ink-muted">“{c.quote}”</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <button type="button" className="text-[13px] font-medium text-accent hover:underline">
                Show in the paper
              </button>
              {c.linked.length > 0 && (
                <span className="text-xs text-ink-muted">Linked: {c.linked.join(', ')}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
