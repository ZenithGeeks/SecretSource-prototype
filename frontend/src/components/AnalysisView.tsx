/**
 * One analysis, from "still loading" to its claims, with the page a claim points at beside
 * them. The prototype screen (App) and the researcher History screen both render this; the
 * form that starts an analysis and the list of past ones stay with the screen.
 *
 * Give it a `key` of the analysis id: the open page and the standing filter belong to one
 * analysis and must not survive a switch to another.
 */

import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { paperName } from '../lib/api'
import type { Analysis } from '../lib/api'
import { countsOf, ranked } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { sectionName, sectionOfPage } from '../lib/outline'
import { useAnalysis } from '../lib/useAnalysis'
import { AnalysisProgress } from './AnalysisProgress'
import { ClaimCard } from './ClaimCard'
import type { Target } from './PageViewer'
import { PageViewer } from './PageViewer'
import { ResultsSummary } from './ResultsSummary'
import { Card, Empty } from './ui'

/** A section picked in the table of contents, to open at its page. `at` tells a newer pick
 * from the page the reader opened or closed since. */
export type SectionJump = { n: string; title: string; page: number; at: number }

export function AnalysisView({
  id,
  onTargetChange,
  section = null,
  onClearSection,
  jump = null,
  onCurrentSection,
  presentation = 'researcher',
  openPaperOnLoad = false,
  renderClaimActions,
}: {
  id: string | null
  /** Fires when the page viewer opens or closes, so the screen can make room for it. */
  onTargetChange?: (open: boolean) => void
  /** List only the claims from this section of the paper (#153). */
  section?: string | null
  onClearSection?: () => void
  /** Open this section's page, unless the reader opened or closed a page after picking it. */
  jump?: SectionJump | null
  /** Which section of the analysed paper the page viewer now shows, for the table of contents. */
  onCurrentSection?: (section: string | null) => void
  /** Teacher uses the same pipeline/results, with the submitted PDF on the left. */
  presentation?: 'researcher' | 'teacher'
  /** Automatically show the submitted PDF when a student analysis becomes available. */
  openPaperOnLoad?: boolean
  /** Add teacher-only review controls inside the shared expanded claim card. */
  renderClaimActions?: (claim: NonNullable<Analysis['claims']>[number], index: number) => ReactNode
}) {
  const [opened, setOpened] = useState<{ target: Target | null; at: number }>({ target: null, at: 0 })
  const [filter, setFilter] = useState<Standing | null>(null)
  const [paperDismissedFor, setPaperDismissedFor] = useState<string | null>(null)
  const paperNotifiedFor = useRef<string | null>(null)
  const analysis = useAnalysis(id)
  const running = analysis.data?.status === 'running'
  const file = analysis.data?.file ? paperName(analysis.data.file) : undefined
  const outline = useMemo(() => analysis.data?.outline ?? [], [analysis.data?.outline])

  const claims = analysis.data?.claims
  // Worst first: a reader is looking for what went wrong, not for the paper's order (#37).
  const standings = useMemo(() => ranked(claims ?? []), [claims])
  const counts = useMemo(() => countsOf(standings), [standings])
  const shown = (filter ? standings.filter((entry) => entry.standing === filter) : standings).filter(
    (entry) => !section || entry.claim.section === section,
  )

  const sectionTarget = jump && file && jump.at > opened.at
    ? { paper: file, label: `Section ${jump.n} · ${jump.title}`, source: null, page: jump.page, section: jump.n }
    : null
  const autoPaperTarget = id && file && openPaperOnLoad && paperDismissedFor !== id
    ? { paper: file, label: 'The paper', source: null, page: 1 }
    : null
  const target: Target | null = sectionTarget ?? opened.target ?? autoPaperTarget

  const setTarget = (next: Target | null) => {
    setOpened({ target: next, at: Date.now() })
    if (!next && id) setPaperDismissedFor(id)
    onTargetChange?.(next !== null)
    const inPaper = next !== null && next.paper === file
    const page = next?.source?.page ?? next?.page
    onCurrentSection?.(inPaper ? (next.section ?? (page ? sectionOfPage(outline, page) : null)) : null)
  }

  useEffect(() => {
    if (!id || !file || !openPaperOnLoad || paperDismissedFor === id || paperNotifiedFor.current === id) return
    paperNotifiedFor.current = id
    onTargetChange?.(true)
    onCurrentSection?.(null)
  }, [id, file, openPaperOnLoad, paperDismissedFor, onTargetChange, onCurrentSection])

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
      <AnalysisProgress stages={analysis.data.stages} claims={analysis.data.claims} status={analysis.data.status} />

      {analysis.data.status === 'error' && (
        <Card className="border-refutes text-refutes">{analysis.data.message}</Card>
      )}

      {/* Wide screens put the page beside the claims and give it the larger part: a PDF page
          below about 600px wide stops being readable. The viewer can also fill the window. */}
      <div
        className={target
          ? presentation === 'teacher'
            ? 'grid gap-4 xl:grid-cols-[minmax(28rem,3fr)_minmax(24rem,2fr)]'
            : 'grid gap-4 xl:grid-cols-[minmax(22rem,2fr)_minmax(32rem,3fr)]'
          : undefined}
      >
        {presentation === 'teacher' && target && (
          <div className="xl:sticky xl:top-6 xl:z-20 xl:self-start">
            <PageViewer
              key={target.paper}
              target={target}
              onClose={() => setTarget(null)}
              markers={target.paper === file ? analysis.data.markers : undefined}
              references={analysis.data.references}
            />
          </div>
        )}

        <section className="space-y-3">
          {standings.length > 0 && (
            <ResultsSummary
              claims={analysis.data.claims}
              standings={standings}
              counts={counts}
              filter={filter}
              onFilter={setFilter}
              paper={file}
              teacherMode={presentation === 'teacher'}
              // The paper itself, from page 1, in the same viewer a claim opens: reading it
              // here keeps the claims in view, where a download or a new tab would not.
              onOpenPaper={file ? () => setTarget({ paper: file, label: 'The paper', source: null, page: 1 }) : undefined}
            />
          )}
          {section && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-ink-muted">
              <span>
                Claims from <span className="font-medium text-ink">{sectionName(outline, section)}</span>
              </span>
              {onClearSection && (
                <button
                  type="button"
                  onClick={onClearSection}
                  className="rounded text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Show all claims
                </button>
              )}
            </p>
          )}
          {section && shown.length === 0 && standings.length > 0 && (
            <p className="px-1 text-sm text-ink-muted">No claims come from this section.</p>
          )}
          {shown.map(({ claim, index, standing }) => (
            <ClaimCard
              key={index}
              claim={claim}
              index={index}
              standing={standing}
              paper={file}
              section={claim.section ? sectionName(outline, claim.section) : undefined}
              figures={analysis.data.figures}
              references={analysis.data.references}
              actions={renderClaimActions?.(claim, index)}
              onSelect={presentation === 'teacher' && file && claim.source
                ? () => setTarget({
                    paper: file,
                    label: `Claim ${index + 1} in the submission`,
                    quote: claim.sentence,
                    source: claim.source ?? null,
                    verdict: ['supports', 'refutes', 'insufficient'].includes(standing)
                      ? standing as 'supports' | 'refutes' | 'insufficient'
                      : undefined,
                  })
                : undefined}
              // A page of the analysed paper carries the claim's section; a cited paper's does not.
              onShow={(next) => setTarget(next.paper === file ? { ...next, section: claim.section } : next)}
            />
          ))}
        </section>

        {target && presentation !== 'teacher' && (
          // Sticky starts its own stacking context, so the viewer's z-50 only counts inside this
          // box. z-20 lifts the box, full-window viewer included, above the sticky summary card (#160).
          <div className="xl:sticky xl:top-6 xl:z-20 xl:self-start">
            <PageViewer
              key={target.paper}
              target={target}
              onClose={() => setTarget(null)}
              // Markers belong to the analysed paper, not to a cited paper opened in the viewer.
              markers={target.paper === file ? analysis.data.markers : undefined}
              references={analysis.data.references}
            />
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
