/**
 * One analysis, from "still loading" to its claims, with the page a claim points at beside
 * them. The prototype screen (App) and the researcher History screen both render this; the
 * form that starts an analysis and the list of past ones stay with the screen.
 *
 * Give it a `key` of the analysis id: the open page and the standing filter belong to one
 * analysis and must not survive a switch to another.
 */

import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { paperName } from '../lib/api'
import { countsOf, ranked } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { useAnalysis } from '../lib/useAnalysis'
import { ClaimCard } from './ClaimCard'
import type { Target } from './PageViewer'
import { PageViewer } from './PageViewer'
import { PipelineStages } from './PipelineStages'
import { ResultsSummary } from './ResultsSummary'
import { Card, Empty } from './ui'

export function AnalysisView({
  id,
  onTargetChange,
}: {
  id: string | null
  /** Fires when the page viewer opens or closes, so the screen can make room for it. */
  onTargetChange?: (open: boolean) => void
}) {
  const [target, setTargetState] = useState<Target | null>(null)
  const [filter, setFilter] = useState<Standing | null>(null)
  const analysis = useAnalysis(id)
  const running = analysis.data?.status === 'running'
  const file = analysis.data?.file ? paperName(analysis.data.file) : undefined

  const claims = analysis.data?.claims
  // Worst first: a reader is looking for what went wrong, not for the paper's order (#37).
  const standings = useMemo(() => ranked(claims ?? []), [claims])
  const counts = useMemo(() => countsOf(standings), [standings])
  const shown = filter ? standings.filter((entry) => entry.standing === filter) : standings

  const setTarget = (next: Target | null) => {
    setTargetState(next)
    onTargetChange?.(next !== null)
  }

  if (!id) {
    return (
      <Empty
        title="Nothing analyzed yet"
        hint="Give a DOI, arXiv ID, URL, or upload a PDF to see its claims and whether its sources back them."
      />
    )
  }

  if (analysis.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading analysis…
      </p>
    )
  }

  if (analysis.isError) {
    return (
      <Card className="border-refutes text-refutes">
        Could not load this analysis: {(analysis.error as Error).message}
      </Card>
    )
  }

  if (!analysis.data) return null

  return (
    <>
      {analysis.data.stages.length > 0 && (
        <Card>
          <PipelineStages stages={analysis.data.stages} running={running} />
        </Card>
      )}

      {analysis.data.status === 'error' && (
        <Card className="border-refutes text-refutes">{analysis.data.message}</Card>
      )}

      {/* Wide screens put the page beside the claims and give it the larger half:
          a PDF page below about 600px wide stops being readable. */}
      <div
        className={
          target ? 'grid gap-4 xl:grid-cols-[minmax(24rem,1fr)_minmax(28rem,42rem)]' : undefined
        }
      >
        <section className="space-y-3">
          {standings.length > 0 && (
            <ResultsSummary
              claims={analysis.data.claims}
              standings={standings}
              counts={counts}
              filter={filter}
              onFilter={setFilter}
              paper={file}
              // The paper itself, from page 1, in the same viewer a claim opens: reading it
              // here keeps the claims in view, where a download or a new tab would not.
              onOpenPaper={file ? () => setTarget({ paper: file, label: 'The paper', source: null, page: 1 }) : undefined}
            />
          )}
          {shown.map(({ claim, index, standing }) => (
            <ClaimCard
              key={index}
              claim={claim}
              index={index}
              standing={standing}
              paper={file}
              figures={analysis.data.figures}
              onShow={setTarget}
            />
          ))}
        </section>

        {target && (
          <div className="xl:sticky xl:top-6 xl:self-start">
            <PageViewer target={target} onClose={() => setTarget(null)} />
          </div>
        )}
      </div>

      {!running && analysis.data.status === 'done' && analysis.data.claims.length === 0 && (
        <Empty
          title="No claims found"
          hint="The extractor read the paper but returned nothing. It may be a scan without a text layer."
        />
      )}
    </>
  )
}
