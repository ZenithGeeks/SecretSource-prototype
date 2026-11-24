/**
 * 09 Home (Researcher) — date, greeting and one-line summary, the Analyze card, contradicted claims,
 * reading queue and library summary, all from the user's own analyses (useResearcherHome).
 * `onOpen` navigates to another researcher screen; a conflict or a queued paper both open the
 * analysis that cites it, and a queued paper's Analyze puts its identifier in the Analyze input.
 */

import { TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'

import { Mascot } from '../../../components/Mascot'
import { Card, ErrorState, FadeIn, LoadingScreen, TextButton, VerdictBadge } from '../../../components/ui'
import { errorMessage } from '../../../lib/author'
import type { Analysis } from '../../../lib/api'
import { countsOf, groupRuns, ranked, STANDING_COLORS, STANDING_LABELS, STANDING_MEANINGS, STANDINGS, type Standing } from '../../../lib/claims'
import { greeting, useSettings } from '../../../lib/settings'
import { stepRows } from '../../../lib/stepRows'
import { useSlashFocus } from '../../../lib/useSlashFocus'
import { useAuth } from '../../../lib/useAuth'
import { useAnalyses } from '../../../lib/useAnalysis'
import { useResearcherHome } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'
import type { ResearcherScreen } from '../ResearcherApp'
import { HomeAnalyzeCard } from '../components/HomeAnalyzeCard'
import { StandingKey } from '../../../components/StandingKey'

/** The library's bar, its legend and the key under them, all over the same standings. As on an
 * analysis's tiles, the four checked standings always show and the other two only when a claim
 * has them. */
function TallyBar({ counts }: { counts: Record<Standing, number> }) {
  const kinds = STANDINGS.filter((kind) => counts[kind] > 0 || (kind !== 'named' && kind !== 'uncited'))
  const total = kinds.reduce((sum, kind) => sum + counts[kind], 0)
  return (
    <>
      {/* With no claims every segment would have zero width: an empty library draws no bar. */}
      {total > 0 && (
        <div className="flex h-2 w-full gap-0.75" aria-hidden="true">
          {kinds.map((kind) => (
            <span key={kind} className={cn('h-full min-w-0 rounded-sm', STANDING_COLORS[kind])} style={{ flexGrow: counts[kind] }} />
          ))}
        </div>
      )}
      {/* The count, then the badge's own words, as on an analysis's tiles. */}
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {kinds.map((kind) => (
          <li key={kind} title={STANDING_MEANINGS[kind]} className="flex items-center gap-1.5 text-ui text-ink-muted">
            <span aria-hidden="true" className={cn('size-2 rounded-full', STANDING_COLORS[kind])} />
            <span className="font-mono text-ink">{counts[kind]}</span>
            {STANDING_LABELS[kind]}
          </li>
        ))}
      </ul>
      <StandingKey />
    </>
  )
}

/** Each paper's newest finished run, as the gateway's library counts papers. */
function libraryRuns(analyses: Analysis[]) {
  return groupRuns(analyses).flatMap(({ run, earlier }) => [run, ...earlier].find((analysis) => analysis.status === 'done') ?? [])
}

const CARD = 'rounded-2xl border border-border-subtle bg-surface shadow-sm'
// The reading queue is a to-do list, not a finding: no shadow, so Conflicts is the card that lifts.
const QUIET_CARD = 'rounded-2xl border border-border-subtle bg-surface'
const CARD_TITLE = 'text-reading font-semibold tracking-tight text-ink'

export function Home({
  onOpen,
  onOpenAnalysis,
}: {
  onOpen: (screen: ResearcherScreen) => void
  onOpenAnalysis: (id: string) => void
}) {
  const { data: home, isError, error, refetch } = useResearcherHome()
  // The library's counts come from the same runs the Analyses list shows, so Home counts all six
  // standings; the gateway's tally has only the four checked ones.
  const analyses = useAnalyses()
  const { displayName } = useSettings()
  const { session } = useAuth()
  const [reference, setReference] = useState('')
  const analyzeInput = useRef<HTMLInputElement>(null)
  useSlashFocus(analyzeInput)
  // One element for the three states of this screen, so the card (and what is typed in it) stays mounted.
  const analyze = (
    <HomeAnalyzeCard
      key="analyze"
      reference={reference}
      onReferenceChange={setReference}
      inputRef={analyzeInput}
      onStarted={onOpenAnalysis}
    />
  )
  if (isError || analyses.isError) {
    return (
      <FadeIn className="flex flex-col gap-7 pt-4">
        {analyze}
        <ErrorState
          title="Your library could not load"
          message={errorMessage(error ?? analyses.error)}
          onRetry={() => {
            void refetch()
            void analyses.refetch()
          }}
        />
      </FadeIn>
    )
  }
  if (!home || !analyses.data) {
    return (
      <FadeIn className="flex flex-col gap-7 pt-4">
        {analyze}
        <LoadingScreen label="Loading your library…" />
      </FadeIn>
    )
  }

  // Prefer the signed-in identity (set at sign-up and by Google) over the Settings display name,
  // the same precedence AppShell's profile menu uses — so the greeting matches who is logged in.
  const metaName = session?.user?.user_metadata?.full_name as string | undefined
  const firstName = (metaName?.trim() || displayName).split(/\s+/)[0]
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const conflictsTotal = home.conflictsTotal ?? home.conflicts.length
  const papers = libraryRuns(analyses.data)
  const claims = papers.flatMap((paper) => paper.claims)

  return (
    <FadeIn className="flex flex-col gap-7 pt-4">
      <header className="flex items-center gap-5">
        <Mascot role="researcher" size={84} className="hidden shrink-0 sm:block" />
        <div className="flex flex-col gap-2">
          <h1 className="type-display font-serif text-ink">{greeting(firstName)}</h1>
          <p className="text-reading leading-6 text-ink-muted">
            {today} · {home.alert}
          </p>
        </div>
      </header>

      {analyze}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Conflicts */}
        <Card
          className={cn(
            CARD,
            'min-w-0 flex-1 p-0 pt-4.5 pb-1.5',
            conflictsTotal > 0 && 'border-refutes/40 shadow-md',
          )}
        >
          <div className="flex items-center gap-2 px-5 pb-2.5">
            {conflictsTotal > 0 && <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-refutes" />}
            <h2 className={cn(CARD_TITLE, 'flex-1')}>Contradicted claims in your library</h2>
            {conflictsTotal > home.conflicts.length && (
              <TextButton onClick={() => onOpen('library')} className="text-ui">
                All {conflictsTotal} in Library
              </TextButton>
            )}
          </div>
          {home.conflicts.length === 0 && (
            <p className="border-t border-border-subtle px-5 py-3 text-sm text-ink-muted">
              {papers.length === 0
                ? 'Nothing is checked yet. Analyze a paper above and any conflict shows up here.'
                : 'No claim in your papers is contradicted by its sources.'}
            </p>
          )}
          <ul onKeyDown={stepRows}>
            {home.conflicts.map((c) => (
              <li key={`${c.analysis}-${c.claimIndex}`} className="border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => onOpenAnalysis(c.analysis)}
                  className="flex w-full min-w-0 flex-col items-start gap-1.5 px-5 py-3 text-left hover:bg-accent-soft"
                >
                  {c.paper && (
                    <span title={c.paper} className="max-w-full truncate text-xs text-ink-muted">
                      {c.paper}
                    </span>
                  )}
                  <span className="line-clamp-2 text-sm leading-6 text-ink">{c.claim}</span>
                  {/* One pill per cited work, so a long list wraps instead of running out of the card.
                      Every row is a contradicted claim; a work that backs it is named second, as such. */}
                  <span className="flex max-w-full flex-wrap items-center gap-2 text-xs text-ink-muted">
                    Contradicted by
                    {c.against.map((work) => (
                      <VerdictBadge key={`against-${work}`} verdict="refutes" text={work} title={work} />
                    ))}
                    {c.for.length > 0 && <span>· Also backed by</span>}
                    {c.for.map((work) => (
                      <VerdictBadge key={`for-${work}`} verdict="supports" text={work} title={work} />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Reading queue */}
        <Card className={cn(QUIET_CARD, 'p-0 pt-4.5 pb-1.5 lg:w-85 lg:shrink-0')}>
          <div className="flex items-center px-5 pb-2.5">
            <h2 className={cn(CARD_TITLE, 'flex-1')}>Reading queue</h2>
            <span className="text-ui font-medium text-ink-muted">{home.queue.length}</span>
          </div>
          {home.queue.length === 0 && (
            <p className="border-t border-border-subtle px-5 py-3 text-sm text-ink-muted">
              Works that your papers cite more than once show up here.
            </p>
          )}
          <ul onKeyDown={stepRows}>
            {home.queue.map((entry) => (
              <li key={entry.paper} className="flex items-center gap-2.5 border-t border-border-subtle py-2.5 pl-5 pr-3.5">
                <button
                  type="button"
                  onClick={() => onOpenAnalysis(entry.analysis)}
                  title="Open the analysis that cites it"
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <span className="max-w-full truncate text-ui font-medium text-ink">{entry.paper}</span>
                  <span className="max-w-full text-xs text-ink-muted">{entry.note}</span>
                </button>
                <button
                  type="button"
                  // The name starts with the visible word, so voice control ("click Analyze") finds it.
                  aria-label={`Analyze ${entry.paper}: put it in the analyze box`}
                  onClick={() => {
                    setReference(entry.identifier)
                    analyzeInput.current?.focus()
                  }}
                  className="shrink-0 rounded-lg border border-border-subtle bg-surface px-3 py-1.75 text-ui font-medium text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11"
                >
                  Analyze…
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Library summary */}
      <section aria-label="Your library" className={cn(CARD, 'flex flex-col gap-3.5 p-5')}>
        <div className="flex items-center gap-2">
          <h2 className={cn(CARD_TITLE, 'flex-1')}>Your library</h2>
          <span className="text-ui text-ink-muted">
            {papers.length} papers · {claims.length} claims
          </span>
          <TextButton onClick={() => onOpen('library')} className="text-ui">
            Open library
          </TextButton>
        </div>
        <TallyBar counts={countsOf(ranked(claims))} />
      </section>
    </FadeIn>
  )
}
