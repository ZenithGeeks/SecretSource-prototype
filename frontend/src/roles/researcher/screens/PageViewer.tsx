/**
 * Page viewer — where "Show in the paper" lands. A claim rail on the left, the paper page on
 * the right with the deciding passage highlighted. The page render is a placeholder until the
 * gateway serves real PDF pages + boxes (the analysis app's PageViewer does the real thing at
 * ?role=app); this gives the researcher flow a working destination in the meantime.
 */

import { useState } from 'react'

import { VerdictBadge } from '../../../components/ui'
import type { PaperVerdict } from '../../../lib/researcher'
import { useResearcherPaper } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'

export type ViewerClaim = { claim: string; verdict: PaperVerdict; quote: string; page?: string }

export function PageViewer({
  title,
  claims,
  active,
  onSelect,
  onBack,
  backLabel = '← Back',
}: {
  title: string
  claims: ViewerClaim[]
  active: number
  onSelect: (i: number) => void
  onBack: () => void
  backLabel?: string
}) {
  const current = claims[active] ?? claims[0]

  return (
    <div className="flex flex-1 gap-4">
      {/* claim rail */}
      <div className="flex w-80 shrink-0 flex-col gap-2">
        <button type="button" onClick={onBack} className="self-start text-[13px] font-medium text-accent hover:underline">
          {backLabel}
        </button>
        <p className="text-sm font-semibold text-ink">Claims</p>
        {claims.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left',
              i === active ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface hover:border-accent',
            )}
          >
            <span className="text-[13px] font-medium text-ink">{c.claim}</span>
            <VerdictBadge verdict={c.verdict} />
          </button>
        ))}
      </div>

      {/* page panel */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
          <span className="text-[13px] font-medium text-ink">
            {title} · {current?.page ?? 'page 4 of 12'}
          </span>
          <div className="flex gap-1.5 text-xs">
            {['−', '100%', '+'].map((z) => (
              <span key={z} className="rounded-md border border-border-subtle px-2 py-1 text-ink">
                {z}
              </span>
            ))}
            <button type="button" className="rounded-md border border-border-subtle px-2 py-1 font-medium text-accent">
              Open PDF
            </button>
          </div>
        </div>

        {/* faux page with highlighted passage */}
        <div className="relative flex-1 overflow-auto bg-[oklch(0.9_0.006_265)] p-8">
          <div className="mx-auto w-[520px] max-w-full rounded-sm border border-border-subtle bg-white p-8 shadow-sm">
            {Array.from({ length: 20 }).map((_, i) => {
              const isQuote = i === 8
              return isQuote ? (
                <p
                  key={i}
                  className="my-2 rounded-sm bg-[oklch(0.94_0.11_95)] px-1 py-1 font-serif text-[13px] italic leading-relaxed text-ink ring-1 ring-[oklch(0.8_0.12_85)]"
                >
                  {current?.quote}
                </p>
              ) : (
                <div
                  key={i}
                  className="my-2.5 h-2 rounded-full bg-[oklch(0.88_0.006_265)]"
                  style={{ width: `${[96, 92, 60, 97, 88, 44, 98, 90, 70][i % 9]}%` }}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Loads a paper and shows its claims in the page viewer, starting on `initialClaim`. */
export function PaperPageViewer({
  projectId,
  paperId,
  initialClaim = 0,
  onBack,
}: {
  projectId: string
  paperId: string
  initialClaim?: number
  onBack: () => void
}) {
  const paper = useResearcherPaper(projectId, paperId).data
  const [active, setActive] = useState(initialClaim)
  if (!paper) return null
  const claims: ViewerClaim[] = paper.claimsDetail.map((c) => ({
    claim: c.claim,
    verdict: c.verdict,
    quote: c.quote,
    page: 'page 4 of 12',
  }))
  return (
    <PageViewer
      title={paper.title.split(':')[0]}
      claims={claims}
      active={Math.min(active, claims.length - 1)}
      onSelect={setActive}
      onBack={onBack}
      backLabel="← Back to paper"
    />
  )
}
