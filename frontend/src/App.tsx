import { FileText, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ClaimCard } from './components/ClaimCard'
import { HistoryList } from './components/HistoryList'
import type { Target } from './components/PageViewer'
import { PageViewer } from './components/PageViewer'
import { PipelineStages } from './components/PipelineStages'
import { ResultsSummary } from './components/ResultsSummary'
import { SubmitForm } from './components/SubmitForm'
import { Card, Empty } from './components/ui'
import { paperName } from './lib/api'
import { countsOf, ranked } from './lib/claims'
import type { Standing } from './lib/claims'
import { cn } from './lib/utils'
import { useAnalyses, useAnalysis } from './lib/useAnalysis'

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [filter, setFilter] = useState<Standing | null>(null)
  const analyses = useAnalyses()
  const analysis = useAnalysis(selected)
  const running = analysis.data?.status === 'running'
  const file = analysis.data?.file ? paperName(analysis.data.file) : undefined

  const claims = analysis.data?.claims
  // Worst first: a reader is looking for what went wrong, not for the paper's order (#37).
  const standings = useMemo(() => ranked(claims ?? []), [claims])
  const counts = useMemo(() => countsOf(standings), [standings])
  const shown = filter ? standings.filter((entry) => entry.standing === filter) : standings

  return (
    <div
      className={cn(
        'mx-auto grid gap-8 p-6 transition-[max-width] duration-200 lg:grid-cols-[16rem_1fr]',
        target ? 'max-w-[110rem]' : 'max-w-6xl',
      )}
    >
      {/* On narrow screens the work comes first and the history follows it. */}
      <aside className="order-2 space-y-3 lg:order-1">
        <h1 className="flex items-center gap-2 px-3 font-semibold lg:px-0">
          <FileText className="size-5 text-accent" />
          SecretSource
        </h1>
        <p className="px-3 text-sm text-ink-muted lg:px-0">
          Checks whether the sources a paper cites actually support what it claims.
        </p>
        <HistoryList analyses={analyses.data ?? []} selected={selected} onSelect={setSelected} />
      </aside>

      <main className="order-1 space-y-6 lg:order-2">
        <SubmitForm onStarted={setSelected} />

        {!selected && (
          <Empty
            title="Nothing analyzed yet"
            hint="Give a DOI, arXiv ID, URL, or upload a PDF to see its claims and whether its sources back them."
          />
        )}

        {selected && analysis.isPending && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" />
            Loading analysis…
          </p>
        )}

        {analysis.isError && (
          <Card className="border-refutes text-refutes">
            Could not load this analysis: {(analysis.error as Error).message}
          </Card>
        )}

        {analysis.data && (
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
                  />
                )}
                {shown.map(({ claim, index, standing }) => (
                  <ClaimCard
                    key={index}
                    claim={claim}
                    index={index}
                    standing={standing}
                    paper={file}
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
        )}
      </main>
    </div>
  )
}
