/**
 * The first ten seconds: how this paper's citations came out, and a way to narrow to one kind.
 * The researcher gets a headline, a verdict bar and four count tiles (Figma "Results"); the
 * Teacher's Essay Check keeps its own toolbar of buttons.
 */

import { FileText } from 'lucide-react'
import { useId } from 'react'

import {
  STANDING_COLORS,
  STANDING_LABELS,
  STANDING_MEANINGS,
  STANDINGS,
  verdictCountLabel,
} from '../lib/claims'
import type { Standing, Standings } from '../lib/claims'
import { API_BASE, type Claim } from '../lib/api'
import { useAuthorizedUrl } from '../lib/useAuthorizedUrl'
import { cn } from '../lib/utils'
import { ToolbarActions } from './AppShell'
import { ExportMenu, TOOLBAR_BUTTON } from './ExportMenu'
import { StandingKey } from './StandingKey'

/** Muted for the two standings that are not a verdict, so a colour always means an answer. */
const COUNT_STYLES: Record<Standing, string> = {
  refutes: 'text-refutes',
  insufficient: 'text-insufficient',
  supports: 'text-supports',
  unchecked: 'text-ink-muted',
  named: 'text-ink-muted',
  uncited: 'text-ink-muted',
}

export function ResultsSummary({
  claims,
  standings,
  counts,
  filter,
  onFilter,
  paper,
  paperLabel,
  onOpenPaper,
  onTeacherFeedback,
  teacherMode = false,
  teacherDecisions,
  actionsInToolbar = false,
  narrow = false,
}: {
  claims: Claim[]
  standings: Standings
  counts: Record<Standing, number>
  filter: Standing | null
  onFilter: (standing: Standing | null) => void
  paper?: string
  /** Optional Teacher label that adds the submitter to the document name. */
  paperLabel?: string
  /** Opens the paper in the page viewer beside the claims; without it the button links to the file. */
  onOpenPaper?: () => void
  /** Jumps to the student feedback composer in the Teacher review. */
  onTeacherFeedback?: () => void
  /** Teacher's Essay Check uses the PDF, Copy All, and CSV analysis toolbar. */
  teacherMode?: boolean
  teacherDecisions?: { supports: number; contradicts: number; inconclusive: number; notReviewed: number }
  /** Put "Open PDF" and "Export" in the shell's toolbar; without a toolbar they sit above the summary. */
  actionsInToolbar?: boolean
  /** The page viewer takes most of the width: the tiles become one row of compact chips. */
  narrow?: boolean
}) {
  if (!teacherMode) {
    return (
      <ResearcherSummary
        claims={claims}
        standings={standings}
        counts={counts}
        filter={filter}
        onFilter={onFilter}
        paper={paper}
        onOpenPaper={onOpenPaper}
        actionsInToolbar={actionsInToolbar}
        narrow={narrow}
      />
    )
  }
  return (
    <TeacherSummary
      claims={claims}
      standings={standings}
      counts={counts}
      filter={filter}
      onFilter={onFilter}
      paper={paper}
      paperLabel={paperLabel}
      onOpenPaper={onOpenPaper}
      onTeacherFeedback={onTeacherFeedback}
      teacherDecisions={teacherDecisions}
    />
  )
}

type SummaryProps = {
  claims: Claim[]
  standings: Standings
  counts: Record<Standing, number>
  filter: Standing | null
  onFilter: (standing: Standing | null) => void
  paper?: string
  onOpenPaper?: () => void
}

/** The sentence over the bar: the one finding a reader came for. */
function headline(counts: Record<Standing, number>) {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
  if (counts.refutes) {
    return `${counts.refutes} ${plural(counts.refutes, 'claim is contradicted by a work it cites', 'claims are contradicted by works they cite')}`
  }
  if (counts.insufficient) {
    // "Silent", as on the tile, so the headline and the count below it use one word.
    return `The works cited for ${counts.insufficient} ${plural(counts.insufficient, 'claim', 'claims')} are silent on ${plural(counts.insufficient, 'it', 'them')}`
  }
  if (counts.unchecked) {
    return `${counts.unchecked} ${plural(counts.unchecked, 'claim', 'claims')} could not be checked`
  }
  if (!counts.supports) return 'No claim cites a work that could be checked against it'
  return 'Every checked citation says what the paper says it does'
}

/** The four kinds the design always counts; "names a tool or dataset" and "no citation" join them
 * only when the paper has such a claim. Tiles, bar and key all follow STANDINGS order. */
const ALWAYS_COUNTED: Standing[] = ['refutes', 'insufficient', 'unchecked', 'supports']

function ResearcherSummary({
  claims,
  counts,
  filter,
  onFilter,
  paper,
  onOpenPaper,
  actionsInToolbar,
  narrow,
}: SummaryProps & { actionsInToolbar: boolean; narrow: boolean }) {
  // Only fetched when there is no page viewer to open it in; the link needs the user's token.
  const pdf = useAuthorizedUrl(paper && !onOpenPaper ? `${API_BASE}/api/papers/${encodeURIComponent(paper)}` : undefined)
  const kinds = STANDINGS.filter((kind) => ALWAYS_COUNTED.includes(kind) || counts[kind] > 0)
  const meaningId = useId()

  const actions = (
    <>
      {paper && onOpenPaper && (
        <button type="button" onClick={onOpenPaper} title="Open PDF: read the paper here, page by page" className={TOOLBAR_BUTTON}>
          <FileText className="size-4" aria-hidden="true" />
          Open PDF
        </button>
      )}
      {pdf.url && (
        <a href={pdf.url} target="_blank" rel="noreferrer" className={TOOLBAR_BUTTON}>
          <FileText className="size-4" aria-hidden="true" />
          Open PDF
        </a>
      )}
      <ExportMenu claims={claims} paper={paper} />
    </>
  )

  return (
    <>
      {actionsInToolbar ? (
        <ToolbarActions>{actions}</ToolbarActions>
      ) : (
        <div className="flex items-center justify-end gap-1">{actions}</div>
      )}
      <section className="flex flex-col gap-4.5 rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
        <p className="text-reading leading-5 font-semibold tracking-[-0.01em]" aria-live="polite">
          {headline(counts)}
        </p>

        {/* The bar shows the proportions, the tiles below it the counts and the filters: one block. */}
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            aria-label={kinds.filter((kind) => counts[kind] > 0).map((kind) => verdictCountLabel(kind, counts[kind])).join(', ')}
            className="flex gap-0.75"
          >
            {STANDINGS.filter((kind) => counts[kind] > 0).map((kind) => (
              <span
                key={kind}
                style={{ flexGrow: counts[kind] }}
                className={cn('h-2 min-w-1 flex-1 basis-0 rounded-sm', STANDING_COLORS[kind])}
              />
            ))}
          </div>
          {/* Each count is the filter for its own kind. None starts selected, so every claim shows.
              One row from sm up, however many kinds there are (a fixed 4 left a fifth tile alone).
              Beside the page viewer the tiles shrink to one wrapping row of "3 Source contradicts"
              chips, so the claims stay above the fold. */}
          <div className={narrow ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-2.5 sm:auto-cols-fr sm:grid-flow-col'}>
            {kinds.map((kind) => {
              const active = filter === kind
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onFilter(active ? null : kind)}
                  aria-pressed={active}
                  // The words the tile shows, so what is heard and what is seen are one string.
                  aria-label={`${counts[kind]} ${STANDING_LABELS[kind]}`}
                  disabled={counts[kind] === 0}
                  title={STANDING_MEANINGS[kind]}
                  // The title shows on hover only; the description reaches keyboard and screen reader users.
                  aria-describedby={`${meaningId}-${kind}`}
                  className={cn(
                    narrow
                      ? 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left transition-colors'
                      : 'flex flex-col items-start gap-0.5 rounded-xl px-3.5 py-3 text-left transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    'disabled:cursor-default disabled:opacity-60',
                    active ? 'bg-accent-soft ring-2 ring-accent' : 'bg-neutral-soft enabled:hover:bg-accent-soft',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      narrow ? 'text-sm font-semibold tabular-nums' : 'text-[26px] leading-8 font-semibold tracking-tight tabular-nums',
                      COUNT_STYLES[kind],
                    )}
                  >
                    {counts[kind]}
                  </span>
                  {/* The badge's own words, so a tile and the claims it filters say the same thing.
                      Two lines tall even when one, so the tiles stay level when a label wraps. */}
                  <span aria-hidden="true" className={cn('text-xs leading-4 font-medium text-ink-muted', !narrow && 'min-h-8')}>
                    {STANDING_LABELS[kind]}
                  </span>
                  <span id={`${meaningId}-${kind}`} className="sr-only">
                    {STANDING_MEANINGS[kind]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        {/* Every standing, since a claim card or the list can show any of them. */}
        <StandingKey />
      </section>
    </>
  )
}

function TeacherSummary({
  standings,
  counts,
  filter,
  onFilter,
  paper,
  paperLabel,
  teacherDecisions,
}: SummaryProps & { paperLabel?: string; onTeacherFeedback?: () => void; teacherDecisions?: { supports: number; contradicts: number; inconclusive: number; notReviewed: number } }) {
  return (
    <div className="-mx-1 rounded-xl border border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur-sm lg:sticky lg:top-0 lg:z-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={paper}>
            {paperLabel ?? paper ?? 'This paper'}
          </p>
          <p className="text-xs text-ink-muted" aria-live="polite">
            {standings.length} claims
            {filter ? `, showing ${counts[filter]} ${STANDING_LABELS[filter].toLowerCase()}` : ''}
          </p>
        </div>

      </div>

      {teacherDecisions && <div className="mt-4 border-t border-border-subtle pt-3" aria-label="Human final decisions">
        <p className="mb-2 text-xs font-semibold text-ink-muted">Human final decisions · citations</p>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-lg bg-supports-soft px-3 py-1.5 text-supports">{teacherDecisions.supports} supports</span>
          <span className="rounded-lg bg-refutes-soft px-3 py-1.5 text-refutes">{teacherDecisions.contradicts} contradicts</span>
          <span className="rounded-lg bg-insufficient-soft px-3 py-1.5 text-insufficient">{teacherDecisions.inconclusive} inconclusive</span>
          <span className="rounded-lg bg-neutral-soft px-3 py-1.5 text-ink-muted">{teacherDecisions.notReviewed} not reviewed</span>
        </div>
      </div>}

      {/* Each count is the filter for its own kind: the number a reader reacts to is the
          control they reach for next. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {STANDINGS.filter((standing) => counts[standing] > 0).map((standing) => {
          const active = filter === standing
          return (
            <button
              key={standing}
              onClick={() => onFilter(active ? null : standing)}
              aria-pressed={active}
              title={STANDING_MEANINGS[standing]}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-border-subtle hover:bg-accent-soft',
              )}
            >
              <span className={cn('tabular-nums', COUNT_STYLES[standing])}>{counts[standing]}</span>{' '}
              {STANDING_LABELS[standing].toLowerCase()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
