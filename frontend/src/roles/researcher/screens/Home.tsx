/**
 * 09 Home (Researcher) — date, greeting and one-line summary, the Analyze card, conflicts,
 * reading queue and library summary, all from the user's own analyses (useResearcherHome).
 * `onOpen` navigates to another researcher screen; a conflict or a queued paper both open the
 * analysis that cites it, and a queued paper's Analyze puts its identifier in the Analyze input.
 */

import { useRef, useState } from 'react'

import { Mascot } from '../../../components/Mascot'
import { Card, ErrorState, FadeIn, LoadingScreen, TextButton, VerdictBadge } from '../../../components/ui'
import { type Standing, verdictCountWord } from '../../../lib/claims'
import type { ClaimStanding, ClaimTally } from '../../../lib/researcher'
import { greeting, useSettings } from '../../../lib/settings'
import { useAuth } from '../../../lib/useAuth'
import { useResearcherHome } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'
import type { ResearcherScreen } from '../ResearcherApp'
import { HomeAnalyzeCard } from '../components/HomeAnalyzeCard'

/** Display order for the library tally; the bar and legend both follow it. */
const STANDINGS: { key: ClaimStanding; kind: Standing; color: string }[] = [
  { key: 'backed', kind: 'supports', color: 'bg-supports' },
  { key: 'silent', kind: 'insufficient', color: 'bg-insufficient' },
  { key: 'contradicted', kind: 'refutes', color: 'bg-refutes' },
  { key: 'unchecked', kind: 'unchecked', color: 'bg-neutral' },
]

function TallyBar({ tally }: { tally: ClaimTally }) {
  return (
    <>
      <div className="flex h-2 w-full gap-[3px]" aria-hidden="true">
        {STANDINGS.map(({ key, color }) => (
          <span key={key} className={cn('h-full min-w-0 rounded', color)} style={{ flexGrow: tally[key] }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {STANDINGS.map(({ key, kind, color }) => (
          <li key={key} className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            <span aria-hidden="true" className={cn('size-2 rounded-full', color)} />
            <span className="font-mono text-ink">{tally[key]}</span>
            {verdictCountWord(kind, tally[key])}
          </li>
        ))}
      </ul>
    </>
  )
}

const CARD = 'rounded-2xl border border-border-subtle bg-surface shadow-sm'
const CARD_TITLE = 'text-[15px] font-semibold tracking-tight text-ink'

export function Home({
  onOpen,
  onOpenAnalysis,
}: {
  onOpen: (screen: ResearcherScreen) => void
  onOpenAnalysis: (id: string) => void
}) {
  const { data: home, isError, error, refetch } = useResearcherHome()
  const { displayName } = useSettings()
  const { session } = useAuth()
  const [reference, setReference] = useState('')
  const analyzeInput = useRef<HTMLInputElement>(null)
  if (isError) {
    return (
      <ErrorState
        title="Your library could not load"
        message={(error as Error | null)?.message ?? 'The gateway did not answer.'}
        onRetry={() => refetch()}
      />
    )
  }
  if (!home) return <LoadingScreen label="Loading your library…" />

  // Prefer the signed-in identity (set at sign-up and by Google) over the Settings display name,
  // the same precedence AppShell's profile menu uses — so the greeting matches who is logged in.
  const metaName = session?.user?.user_metadata?.full_name as string | undefined
  const firstName = (metaName?.trim() || displayName).split(/\s+/)[0]
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const conflictsTotal = home.conflictsTotal ?? home.conflicts.length

  return (
    <FadeIn className="flex flex-col gap-7 pt-4">
      <header className="flex items-center gap-5">
        <Mascot role="researcher" size={84} className="hidden shrink-0 sm:block" />
        <div className="flex flex-col gap-2">
          <p className="type-label text-accent">{today}</p>
          <h1 className="type-display font-serif text-ink">{greeting(firstName)}</h1>
          <p className="text-[15px] leading-6 text-ink-muted">{home.alert}</p>
        </div>
      </header>

      <HomeAnalyzeCard
        reference={reference}
        onReferenceChange={setReference}
        inputRef={analyzeInput}
        onStarted={onOpenAnalysis}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Conflicts */}
        <Card className={cn(CARD, 'min-w-0 flex-1 p-0 pt-[18px] pb-1.5')}>
          <div className="flex items-center px-5 pb-2.5">
            <h2 className={cn(CARD_TITLE, 'flex-1')}>Conflicts in your library</h2>
            {conflictsTotal > home.conflicts.length && (
              <TextButton onClick={() => onOpen('library')} className="text-[13px]">
                All {conflictsTotal} in Library
              </TextButton>
            )}
          </div>
          {home.conflicts.length === 0 && (
            <p className="border-t border-border-subtle px-5 py-3 text-sm text-ink-muted">
              No claim in your papers is contradicted by its sources.
            </p>
          )}
          <ul>
            {home.conflicts.map((c) => (
              <li key={`${c.analysis}-${c.claimIndex}`} className="border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => onOpenAnalysis(c.analysis)}
                  className="flex w-full min-w-0 flex-col items-start gap-1.5 px-5 py-3 text-left hover:bg-accent-soft"
                >
                  {c.paper && <span className="max-w-full truncate text-xs text-ink-muted">{c.paper}</span>}
                  <p className="line-clamp-2 text-sm leading-6 text-ink">{c.claim}</p>
                  {/* One pill per cited work, so a long list wraps instead of running out of the card. */}
                  <span className="flex max-w-full flex-wrap items-center gap-2">
                    {c.against.map((work) => (
                      <VerdictBadge key={`against-${work}`} verdict="refutes" text={work} title={work} />
                    ))}
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
        <Card className={cn(CARD, 'p-0 pt-[18px] pb-1.5 lg:w-[340px] lg:shrink-0')}>
          <div className="flex items-center px-5 pb-2.5">
            <h2 className={cn(CARD_TITLE, 'flex-1')}>Reading queue</h2>
            <span className="text-[13px] font-medium text-ink-muted">{home.queue.length}</span>
          </div>
          {home.queue.length === 0 && (
            <p className="border-t border-border-subtle px-5 py-3 text-sm text-ink-muted">
              Works that your papers cite more than once show up here.
            </p>
          )}
          <ul>
            {home.queue.map((entry) => (
              <li key={entry.paper} className="flex items-center gap-2.5 border-t border-border-subtle py-2.5 pl-5 pr-3.5">
                <button
                  type="button"
                  onClick={() => onOpenAnalysis(entry.analysis)}
                  title="Open the analysis that cites it"
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <span className="max-w-full truncate text-[13px] font-medium text-ink">{entry.paper}</span>
                  <span className="max-w-full text-xs text-ink-muted">{entry.note}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Put ${entry.paper} in the analyze box`}
                  onClick={() => {
                    setReference(entry.identifier)
                    analyzeInput.current?.focus()
                  }}
                  className="shrink-0 rounded-[9px] border border-border-subtle bg-surface px-3 py-[7px] text-[13px] font-medium text-ink hover:bg-accent-soft"
                >
                  Analyze
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
          <span className="text-[13px] text-ink-muted">
            {home.library.papers} papers · {home.library.claims} claims
          </span>
          <TextButton onClick={() => onOpen('library')} className="text-[13px]">
            Open library
          </TextButton>
        </div>
        <TallyBar tally={home.library.tally} />
      </section>
    </FadeIn>
  )
}
