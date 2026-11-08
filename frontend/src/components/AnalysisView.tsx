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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { paperName } from '../lib/api'
import type { Analysis, Claim } from '../lib/api'
import { countsOf, opensByDefault, ranked, standingOf, verdictCountLabel } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { sectionName, sectionOfPage } from '../lib/outline'
import { useAnalysis } from '../lib/useAnalysis'
import { AnalysisHeader } from './AnalysisHeader'
import { AnalysisProgress } from './AnalysisProgress'
import { ClaimCard } from './ClaimCard'
import type { Target } from './PageViewer'
import { PageViewer } from './PageViewer'
import { ResultsSummary } from './ResultsSummary'
import { Card, Empty } from './ui'

/** A section picked in the table of contents, to open at its page. `at` tells a newer pick
 * from the page the reader opened or closed since. */
export type SectionJump = { n: string; title: string; page: number; at: number }

/** A claim the run has finished with: it has an answer, a failure, or nothing to check. */
function settled(claim: Claim) {
  return (claim.verdicts ?? []).length > 0 || (claim.unchecked ?? []).length > 0 || claim.citations.length === 0
}

/** A claim row that has not been answered yet, in the shape the answer will take. */
function SkeletonRow({ fade }: { fade: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center gap-3.5 border-t border-border-subtle px-5 py-4 ${fade}`}>
      <span className="size-2.5 shrink-0 rounded-sm bg-neutral-soft" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="h-2.5 w-3/4 rounded-md bg-neutral-soft" />
        <span className="h-2 w-36 rounded bg-neutral-soft" />
      </span>
      <span className="h-5 w-[84px] shrink-0 rounded-[10px] bg-neutral-soft" />
    </div>
  )
}

export function AnalysisView({
  id,
  onTargetChange,
  section = null,
  onClearSection,
  jump = null,
  onCurrentSection,
  presentation = 'researcher',
  openPaperOnLoad = false,
  paperLabel,
  onTeacherFeedback,
  renderClaimActions,
  actionsInToolbar = false,
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
  /** Teacher's roster label for the student's submitted file. */
  paperLabel?: string
  /** Opens the teacher feedback composer below the claim review. */
  onTeacherFeedback?: () => void
  /** Add teacher-only review controls inside the shared expanded claim card. */
  renderClaimActions?: (claim: NonNullable<Analysis['claims']>[number], index: number) => ReactNode
  /** Put "Open PDF" and "Export" in the shell's toolbar (the researcher shell has one). */
  actionsInToolbar?: boolean
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
  // Ranked worst first, so the first claim that needs nothing starts the settled group.
  const settledFrom = shown.findIndex((entry) => !opensByDefault(entry.standing))

  const sectionTarget = jump && file && jump.at > opened.at
    ? { paper: file, label: `Section ${jump.n} · ${jump.title}`, source: null, page: jump.page, section: jump.n }
    : null
  const initialTeacherClaim = presentation === 'teacher' ? standings[0] : undefined
  const autoPaperTarget = id && file && openPaperOnLoad && paperDismissedFor !== id
    ? initialTeacherClaim?.claim.source
      ? {
          paper: file,
          label: `Claim ${initialTeacherClaim.index + 1} in this paper`,
          quote: initialTeacherClaim.claim.sentence,
          source: initialTeacherClaim.claim.source,
          page: initialTeacherClaim.claim.source.page,
          verdict: ['supports', 'refutes', 'insufficient'].includes(initialTeacherClaim.standing)
            ? initialTeacherClaim.standing as 'supports' | 'refutes' | 'insufficient'
            : undefined,
        }
      : { paper: file, label: 'The paper', source: null, page: 1 }
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

  const teacher = presentation === 'teacher'
  const settledCount = analysis.data.claims.filter(settled).length
  const pending = Math.min(3, analysis.data.claims.length - settledCount)
  const attention = counts.refutes + counts.insufficient + counts.unchecked > 0

  const content = (
    <>
      {!teacher && <AnalysisHeader analysis={analysis.data} />}
      {(!teacher || running) && <AnalysisProgress stages={analysis.data.stages} claims={analysis.data.claims} status={analysis.data.status} />}

      {analysis.data.status === 'error' && (
        <p role="alert" className="rounded-2xl border border-refutes bg-refutes-soft px-5 py-4 text-sm text-refutes">
          {analysis.data.message}
        </p>
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

        <section className={teacher ? 'space-y-3' : 'flex flex-col gap-3.5'}>
          {!teacher && running && analysis.data.claims.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-1">
                <h2 className="type-title flex-1">Results so far</h2>
                <p className="text-[13px] text-ink-muted" aria-live="polite">
                  {settledCount} of {analysis.data.claims.length} claims
                </p>
              </div>
              {/* Answers appear as they finish, in the paper's order; the rest are placeholders. */}
              <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card">
                {analysis.data.claims.flatMap((claim, index) =>
                  settled(claim)
                    ? [
                        <div key={index} className="border-t border-border-subtle first:border-t-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
                          <ClaimCard
                            claim={claim}
                            index={index}
                            standing={standingOf(claim)}
                            paper={file}
                            section={claim.section ? sectionName(outline, claim.section) : undefined}
                            figures={analysis.data.figures}
                            references={analysis.data.references}
                            startCollapsed
                            onShow={(next) => setTarget(next.paper === file ? { ...next, section: claim.section } : next)}
                          />
                        </div>,
                      ]
                    : [],
                )}
                {Array.from({ length: pending }, (_, i) => (
                  <SkeletonRow key={`skeleton-${i}`} fade={['', 'opacity-75', 'opacity-50'][i]} />
                ))}
              </div>
            </>
          )}
          {(teacher || !running) && standings.length > 0 && (
            <ResultsSummary
              claims={analysis.data.claims}
              standings={standings}
              counts={counts}
              filter={filter}
              onFilter={setFilter}
              paper={file}
              paperLabel={presentation === 'teacher' ? paperLabel : undefined}
              teacherMode={presentation === 'teacher'}
              actionsInToolbar={actionsInToolbar}
              onTeacherFeedback={presentation === 'teacher' ? onTeacherFeedback : undefined}
              // The paper itself, from page 1, in the same viewer a claim opens: reading it
              // here keeps the claims in view, where a download or a new tab would not.
              onOpenPaper={file ? () => setTarget({ paper: file, label: 'The paper', source: null, page: 1 }) : undefined}
            />
          )}
          {!teacher && !running && standings.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <h2 className="type-title flex-1">{attention ? 'Needs your attention' : 'All claims'}</h2>
              {filter && (
                <p className="text-[13px] text-ink-muted" aria-live="polite">
                  Showing {verdictCountLabel(filter, counts[filter])}
                </p>
              )}
            </div>
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
          {(teacher || !running) && shown.map(({ claim, index, standing }, i) => (
            <Fragment key={index}>
              {!teacher && i > 0 && i === settledFrom && <h2 className="type-title pt-3">Settled</h2>}
              <ClaimCard
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
            </Fragment>
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

  if (teacher) return content
  // Open beside a page the column fills the shell; on its own it reads at the width of a paper.
  return (
    <div className={`flex flex-col gap-7 ${target ? 'w-full' : 'mx-auto w-full max-w-[880px]'}`}>
      {content}
    </div>
  )
}
