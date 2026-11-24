/**
 * One analysis, from "still loading" to its claims, with the page a claim points at beside
 * them. The prototype screen (App) and the researcher History screen both render this; the
 * form that starts an analysis and the list of past ones stay with the screen.
 *
 * Give it a `key` of the analysis id: the open page and the standing filter belong to one
 * analysis and must not survive a switch to another.
 */

import { useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { paperName } from '../lib/api'
import type { Analysis, Claim, OutlineEntry } from '../lib/api'
import { countsOf, opensByDefault, ranked, runTime, STANDING_LABELS, standingOf } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { sectionName, sectionOfPage } from '../lib/outline'
import { OpenParts } from '../lib/openParts'
import { useAnalysis } from '../lib/useAnalysis'
import { cn } from '../lib/utils'
import { AnalysisHeader } from './AnalysisHeader'
import { AnalysisProgress } from './AnalysisProgress'
import { ClaimCard } from './ClaimCard'
import { FailedRun } from './FailedRun'
import type { Target } from './PageViewer'
import { PageViewer } from './PageViewer'
import { ResultsSummary } from './ResultsSummary'
import { KEY_CAP } from './StandingKey'
import { Card, Empty } from './ui'

/** A section picked in the table of contents, to open at its page. `at` tells a newer pick
 * from the page the reader opened or closed since. */
export type SectionJump = { n: string; title: string; page: number; at: number }

/** The standing as a verdict colour for the page viewer; the standings that are not a verdict have none. */
function verdictOf(standing: Standing): Target['verdict'] {
  return standing === 'supports' || standing === 'refutes' || standing === 'insufficient' ? standing : undefined
}

/** "Show all claims", after a section or a standing narrowed the list. */
const CLEAR_BUTTON = 'rounded-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent'

/** The open page and the card parts the reader opened, kept in the history entry so Back and
 * Forward into this analysis find them as the reader left them. */
type SavedView = { id: string; target: Target | null; parts: [string, boolean][] }

function savedView(id: string | null): SavedView | undefined {
  const view = (window.history.state as { analysisView?: SavedView } | null)?.analysisView
  return id !== null && view?.id === id ? view : undefined
}

function saveView(id: string | null, change: Partial<SavedView>) {
  // Only into this analysis's own entry: after Back, the address already names the page before it.
  if (id === null || new URLSearchParams(window.location.search).get('analysis') !== id) return
  const view: SavedView = { target: null, parts: [], ...savedView(id), ...change, id }
  window.history.replaceState({ ...window.history.state, analysisView: view }, '')
}

/** OpenParts for one analysis, filled from and written through to its history entry. */
class SavedParts extends Map<string, boolean> {
  private readonly id: string | null

  constructor(id: string | null) {
    super()
    this.id = id
    for (const [key, open] of savedView(id)?.parts ?? []) super.set(key, open)
  }

  set(key: string, open: boolean) {
    super.set(key, open)
    saveView(this.id, { parts: [...this] })
    return this
  }
}

/** Shaped as the evidence page chips are, so a filter reads as a chip and not as a heading. */
const CHIP = 'inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1.25 text-xs leading-4 font-medium text-accent'

/** One filter in use, by its name, and the × that clears it when the screen can clear it. */
function FilterChip({ label, onClear }: { label: string; onClear?: () => void }) {
  if (!onClear) return <span className={CHIP}>{label}</span>
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear the ${label} filter`}
      className={cn(CHIP, 'hover:underline focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11')}
    >
      {label}
      <X className="size-3.5" aria-hidden="true" />
    </button>
  )
}

/** "§2 Background": a section as the claim cards name it. */
function sectionChip(outline: OutlineEntry[], n: string) {
  return sectionName(outline, n).replace(/^Section\s+/, '§').replace(' · ', ' ')
}

/** Why a picked section lists nothing: it has no claims, or none with the picked standing. */
function SectionEmpty({ claims, filter, onShowAll }: { claims: number; filter: Standing | null; onShowAll: () => void }) {
  if (!claims || !filter) return <p className="px-1 text-sm text-ink-muted">No claims come from this section.</p>
  const noun = claims === 1 ? 'claim' : 'claims'
  return (
    <p className="px-1 text-sm text-ink-muted">
      None of this section’s {claims} {noun} is “{STANDING_LABELS[filter]}” ·{' '}
      <button type="button" onClick={onShowAll} className={CLEAR_BUTTON}>
        Show its {claims} {noun}
      </button>
    </p>
  )
}

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
        <span className="h-3 w-3/4 rounded-md bg-neutral-soft" />
        <span className="h-2 w-36 rounded-sm bg-neutral-soft" />
      </span>
      <span className="h-5 w-20 shrink-0 rounded-lg bg-neutral-soft" />
    </div>
  )
}

export function AnalysisView({
  id,
  onTargetChange,
  section = null,
  onClearSection,
  filter: shownFilter,
  onFilter,
  jump = null,
  onCurrentSection,
  presentation = 'researcher',
  openPaperOnLoad = false,
  paperLabel,
  onTeacherFeedback,
  renderClaimActions,
  teacherDecisions,
  actionsInToolbar = false,
  onRetried,
}: {
  id: string | null
  /** Fires when the page viewer opens or closes, so the screen can make room for it. */
  onTargetChange?: (open: boolean) => void
  /** List only the claims from this section of the paper (#153). */
  section?: string | null
  onClearSection?: () => void
  /** The standing the claims are narrowed to, when the screen keeps it (the table of contents
   * counts by it); without it the view keeps its own. */
  filter?: Standing | null
  onFilter?: (standing: Standing | null) => void
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
  teacherDecisions?: { supports: number; contradicts: number; inconclusive: number; notReviewed: number }
  /** Put "Open PDF" and "Export" in the shell's toolbar (the researcher shell has one). */
  actionsInToolbar?: boolean
  /** Opens another run of the paper from a failed one: its retry, or a later run that finished. */
  onRetried?: (id: string) => void
}) {
  const restorable = presentation !== 'teacher'
  const [restored] = useState(() => (restorable ? (savedView(id)?.target ?? null) : null))
  const [opened, setOpened] = useState<{ target: Target | null; at: number }>({ target: restored, at: 0 })
  const restoredNotified = useRef(false)
  const activeLookup = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    activeLookup.current = undefined
  }, [jump])
  const [ownFilter, setOwnFilter] = useState<Standing | null>(null)
  const filter = shownFilter === undefined ? ownFilter : shownFilter
  const keepFilter = onFilter ?? setOwnFilter
  const [paperDismissedFor, setPaperDismissedFor] = useState<string | null>(null)
  // What a shortcut did instead, or could not do: read out, and shown on the claim's card, or in
  // the viewer's header when the viewer opened (`inViewer`, its words), so the card keeps its section and page.
  const [keyNotice, setKeyNotice] = useState<{ claim: number; text: string; inViewer?: string } | null>(null)
  const paperNotifiedFor = useRef<string | null>(null)
  // What the reader opened on the claim cards, kept here so a filter change does not fold it.
  const [openParts] = useState(() => (restorable ? new SavedParts(id) : new Map<string, boolean>()))
  const queryClient = useQueryClient()
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

  // J and K move the keyboard to the next or previous claim's row, the way a reader works
  // through a list of problems. O shows the focused claim's evidence in the cited paper.
  useEffect(() => {
    if (presentation === 'teacher') return
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!['j', 'k', 'o'].includes(key) || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      const focused = document.activeElement
      setKeyNotice(null)
      if (key === 'o') {
        const card = focused?.closest<HTMLElement>('[data-claim-card]')
        if (!card) return
        event.preventDefault()
        // Looked up again each time: opening a folded card renders it as a new element.
        const inCard = (selector: string) => document.querySelector<HTMLElement>(`[data-claim="${card.dataset.claim}"] ${selector}`)
        const claim = Number(card.dataset.claim)
        const show = () => {
          // The cited work's quote, else (the card marks it) the claim's place in this paper.
          const action = inCard('[aria-keyshortcuts="O"]')
          action?.click()
          // The card says why it has no cited quote: no verdicts at all, or none matched a passage.
          const why = action?.dataset.inPaper
          if (!action) setKeyNotice({ claim, text: `No quoted passage to show for claim ${claim + 1}` })
          else if (why) {
            setKeyNotice({
              claim,
              text: `${why} · showing claim ${claim + 1} in this paper`,
              inViewer: `${why}, so this is where the claim sits in the paper.`,
            })
          }
        }
        const toggle = inCard('[data-claim-toggle][aria-expanded="false"]')
        if (!toggle) return show()
        // A folded card has no evidence to show yet: open it, keep the keyboard on it, then show.
        toggle.click()
        setTimeout(() => {
          inCard('[data-claim-toggle]')?.focus()
          show()
        })
        return
      }
      const rows = [...document.querySelectorAll<HTMLElement>('[data-claim-toggle]')]
      if (!rows.length) return
      event.preventDefault()
      const at = rows.findIndex((row) => row.closest('[data-claim-card]')!.contains(focused))
      const to = key === 'j' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)
      // The card goes near the top, under its scroll margin, so what follows the row is in view too.
      const card = rows[to].closest<HTMLElement>('[data-claim-card]')!
      rows[to].focus({ preventScroll: true })
      if (typeof card.scrollIntoView === 'function') {
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presentation])

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
          verdict: verdictOf(initialTeacherClaim.standing),
        }
      : { paper: file, label: 'The paper', source: null, page: 1 }
    : null
  const target: Target | null = sectionTarget ?? opened.target ?? autoPaperTarget

  // Whatever the viewer shows, a section's page or a quote still being looked up included, goes
  // into the history entry, so Forward brings back the latest page and not an older one. A
  // lookup cannot resume after a restore, so the page is kept without it.
  const savedTarget = restorable ? JSON.stringify(target && { ...target, lookup: undefined, locating: undefined }) : null
  useEffect(() => {
    if (savedTarget !== null) saveView(id, { target: JSON.parse(savedTarget) as Target | null })
  }, [id, savedTarget])

  // The page stays open when a filter hides its claim: closing it would lose the reader's place
  // and move the list under the pointer. Its header says so instead.
  const hiddenClaim = target?.claim !== undefined && !shown.some((entry) => entry.index === target.claim) ? target.claim : null
  const showAllClaims = () => {
    keepFilter(null)
    onClearSection?.()
  }
  // Another claim opened or reached with J/K keeps the page; its label leads back to its claim.
  const backToClaim = () => {
    const card = document.querySelector<HTMLElement>(`[data-claim="${target?.claim}"]`)
    card?.querySelector<HTMLElement>('[data-claim-toggle]')?.focus()
    card?.scrollIntoView({ block: 'start' })
  }

  const setTarget = (next: Target | null) => {
    if (next?.lookup !== undefined && !next.locating && next.lookup !== activeLookup.current) return
    activeLookup.current = next?.locating ? next.lookup : undefined
    setKeyNotice(null)
    setOpened({ target: next, at: Date.now() })
    if (!next && id) setPaperDismissedFor(id)
    onTargetChange?.(next !== null)
    const inPaper = next !== null && next.paper === file
    const page = next?.source?.page ?? next?.page
    onCurrentSection?.(inPaper ? (next.section ?? (page ? sectionOfPage(outline, page) : null)) : null)
  }

  // A page restored from the history entry widens the shell, as opening one does.
  useEffect(() => {
    if (!restored || restoredNotified.current) return
    restoredNotified.current = true
    onTargetChange?.(true)
  }, [restored, onTargetChange])

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
  const ownsAnalysis = !teacher
  const current = analysis.data
  // Only the owner of a finished analysis may attach a PDF. A running analysis answers 409,
  // and a teacher is reading someone else's submission.
  const sourceUpload = ownsAnalysis && current.status === 'done'
    ? {
        analysisId: current.id,
        onUploaded: () => queryClient.invalidateQueries({ queryKey: ['analysis', current.id] }),
      }
    : undefined
  const settledCount = analysis.data.claims.filter(settled).length
  const pending = Math.min(3, analysis.data.claims.length - settledCount)
  const attention = counts.refutes + counts.insufficient + counts.unchecked > 0

  const content = (
    <>
      {!teacher && <AnalysisHeader analysis={analysis.data} />}
      {(!teacher || running) && (
        <AnalysisProgress
          stages={analysis.data.stages}
          claims={analysis.data.claims}
          status={analysis.data.status}
          when={analysis.data.status === 'error' ? runTime(analysis.data) : undefined}
        />
      )}

      {analysis.data.status === 'error' && <FailedRun analysis={analysis.data} onOpen={onRetried} />}

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
                <p className="text-ui text-ink-muted" aria-live="polite">
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
                            stages={analysis.data.stages}
                            pdfs={analysis.data.pdfs}
                            ownsAnalysis={ownsAnalysis}
                            sourceUpload={sourceUpload}
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
              onFilter={keepFilter}
              paper={file}
              paperLabel={presentation === 'teacher' ? paperLabel : undefined}
              teacherMode={presentation === 'teacher'}
              teacherDecisions={teacherDecisions}
              actionsInToolbar={actionsInToolbar}
              narrow={target !== null}
              onTeacherFeedback={presentation === 'teacher' ? onTeacherFeedback : undefined}
              // The paper itself, from page 1, in the same viewer a claim opens: reading it
              // here keeps the claims in view, where a download or a new tab would not.
              onOpenPaper={file ? () => setTarget({ paper: file, label: 'The paper', source: null, page: 1 }) : undefined}
            />
          )}
          {!teacher && !running && standings.length > 0 && (
            // Beside the page viewer the column is narrow, so the hint and the count go under the heading.
            <div className={cn('flex gap-2 pt-1', target ? 'flex-col items-start' : 'items-center')}>
              {/* Filtered to one standing, the heading is that standing's badge words. */}
              <h2 className="type-title flex-1">
                {filter ? STANDING_LABELS[filter] : attention ? 'Needs your attention' : 'All claims'}
              </h2>
              <p className="text-ui text-ink-muted pointer-coarse:hidden">
                <kbd className={KEY_CAP}>J</kbd> and <kbd className={KEY_CAP}>K</kbd> move between claims ·{' '}
                <kbd className={KEY_CAP}>O</kbd> shows the evidence
              </p>
            </div>
          )}
          {!teacher && !running && standings.length > 0 && (filter || section) && (
            // Each filter in use is a chip that names it and clears it; with two, one button clears both.
            <div className="flex flex-wrap items-center gap-2 text-ui text-ink-muted">
              <p aria-live="polite">
                Showing {shown.length} of {standings.length}
              </p>
              {filter && <FilterChip label={STANDING_LABELS[filter]} onClear={() => keepFilter(null)} />}
              {section && <FilterChip label={sectionChip(outline, section)} onClear={onClearSection} />}
              {filter && section && onClearSection && (
                <button type="button" onClick={showAllClaims} className={CLEAR_BUTTON}>
                  Clear all
                </button>
              )}
            </div>
          )}
          <p role="status" className="sr-only">
            {keyNotice?.text}
          </p>
          {section && shown.length === 0 && standings.length > 0 && (
            <SectionEmpty
              claims={standings.filter((entry) => entry.claim.section === section).length}
              filter={filter}
              onShowAll={() => keepFilter(null)}
            />
          )}
          {(teacher || !running) && shown.map(({ claim, index, standing }, i) => (
            <Fragment key={!teacher && i === 0 ? `first-${index}` : index}>
              {!teacher && i > 0 && i === settledFrom && <h2 className="type-title pt-3">Settled</h2>}
              <ClaimCard
                // Only the first visible claim opens in finished non-teacher results.
                defaultOpen={teacher ? undefined : i === 0}
                claim={claim}
                index={index}
                standing={standing}
                paper={file}
                section={claim.section ? sectionName(outline, claim.section) : undefined}
                figures={analysis.data.figures}
                references={analysis.data.references}
                analysisId={teacher ? undefined : analysis.data.id}
                disputes={analysis.data.disputes}
                stages={analysis.data.stages}
                pdfs={analysis.data.pdfs}
                ownsAnalysis={ownsAnalysis}
                sourceUpload={sourceUpload}
                actions={renderClaimActions?.(claim, index)}
                stacked={target !== null && !teacher}
                notice={keyNotice?.claim === index && !keyNotice.inViewer ? keyNotice.text : undefined}
                onSelect={presentation === 'teacher' && file && claim.source
                  ? () => setTarget({
                      paper: file,
                      label: `Claim ${index + 1} in the submission`,
                      quote: claim.sentence,
                      /* v8 ignore next -- the condition above already holds a source; this satisfies the type */
                      source: claim.source ?? null,
                      verdict: verdictOf(standing),
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
          // box. Left at no z-index the box stays under the shell's toolbar and its Export menu;
          // a full-window viewer (fixed) lifts it over them. Under the 52px toolbar (13 spacing
          // steps) it starts below it, not on its buttons.
          <div className={cn('xl:sticky xl:self-start xl:has-[.fixed]:z-30', actionsInToolbar ? 'xl:top-17' : 'xl:top-6')}>
            <PageViewer
              key={target.paper}
              onLabel={target.claim === undefined ? undefined : backToClaim}
              notice={
                <>
                  {keyNotice?.inViewer && <p className="text-xs text-ink-muted">{keyNotice.inViewer}</p>}
                  {hiddenClaim !== null && (
                    <p className="text-xs text-ink-muted">
                      Claim {hiddenClaim + 1} is hidden by the current filter ·{' '}
                      <button type="button" onClick={showAllClaims} className={CLEAR_BUTTON}>
                        Show all claims
                      </button>
                    </p>
                  )}
                </>
              }
              className={actionsInToolbar ? 'h-[calc(100vh-var(--spacing)*21)]' : undefined}
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

  if (teacher) return <OpenParts.Provider value={openParts}>{content}</OpenParts.Provider>
  // Open beside a page the column fills the shell; on its own it reads at the width of a paper.
  return (
    <OpenParts.Provider value={openParts}>
      <div className={`flex flex-col gap-7 ${target ? 'w-full' : 'mx-auto w-full max-w-4xl'}`}>{content}</div>
    </OpenParts.Provider>
  )
}
