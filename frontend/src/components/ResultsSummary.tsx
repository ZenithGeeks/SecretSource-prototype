/**
 * The first ten seconds: how this paper's citations came out, and a way to narrow to one kind.
 * The researcher gets a headline, a verdict bar and four count tiles (Figma "Results"); the
 * Teacher's Essay Check keeps its own toolbar of buttons.
 */

import { Copy, Download, FileText, MessageSquarePlus } from 'lucide-react'
import { useState } from 'react'

import {
  STANDING_LABELS,
  STANDING_MEANINGS,
  STANDINGS,
  toCsv,
  toMarkdown,
  verdictCountLabel,
  verdictCountWord,
} from '../lib/claims'
import type { Standing, Standings } from '../lib/claims'
import { API_BASE, type Claim } from '../lib/api'
import { useAuthorizedUrl } from '../lib/useAuthorizedUrl'
import { cn } from '../lib/utils'
import { downloadText } from '../lib/csv'
import { ToolbarActions } from './AppShell'
import { ExportMenu, TOOLBAR_BUTTON } from './ExportMenu'
import { Button } from './ui'

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
  actionsInToolbar = false,
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
  /** Put "Open PDF" and "Export" in the shell's toolbar; without a toolbar they sit above the summary. */
  actionsInToolbar?: boolean
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
    return `${counts.refutes} ${plural(counts.refutes, 'claim is', 'claims are')} contradicted by a work they cite`
  }
  if (counts.insufficient) {
    return `${counts.insufficient} ${plural(counts.insufficient, 'claim is', 'claims are')} not settled by the works they cite`
  }
  if (counts.unchecked) {
    return `${counts.unchecked} ${plural(counts.unchecked, 'claim', 'claims')} could not be checked`
  }
  if (!counts.supports) return 'No claim cites a work that could be checked against it'
  return 'Every checked citation says what the paper says it does'
}

const BAR_STYLES: Record<Standing, string> = {
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
  supports: 'bg-supports',
  unchecked: 'bg-neutral',
  named: 'bg-neutral',
  uncited: 'bg-neutral',
}

/** The four kinds the design counts; "names what it uses" and "no citation" join them only
 * when the paper has such a claim. */
const TILES: Standing[] = ['refutes', 'insufficient', 'supports', 'unchecked']

function ResearcherSummary({
  claims,
  counts,
  filter,
  onFilter,
  paper,
  onOpenPaper,
  actionsInToolbar,
}: SummaryProps & { actionsInToolbar: boolean }) {
  // Only fetched when there is no page viewer to open it in; the link needs the user's token.
  const pdf = useAuthorizedUrl(paper && !onOpenPaper ? `${API_BASE}/api/papers/${encodeURIComponent(paper)}` : undefined)
  const kinds = [...TILES, ...(['named', 'uncited'] as const).filter((kind) => counts[kind] > 0)]

  const actions = (
    <>
      {paper && onOpenPaper && (
        <button type="button" onClick={onOpenPaper} title="Read the paper here, page by page" className={TOOLBAR_BUTTON}>
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
      <section className="flex flex-col gap-[18px] rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
        <p className="text-[15px] leading-5 font-semibold tracking-[-0.01em]" aria-live="polite">
          {headline(counts)}
        </p>

        <div
          role="img"
          aria-label={kinds.filter((kind) => counts[kind] > 0).map((kind) => verdictCountLabel(kind, counts[kind])).join(', ')}
          className="flex gap-[3px]"
        >
          {STANDINGS.filter((kind) => counts[kind] > 0).map((kind) => (
            <span
              key={kind}
              style={{ flexGrow: counts[kind] }}
              className={cn('h-2 min-w-1 flex-1 basis-0 rounded', BAR_STYLES[kind])}
            />
          ))}
        </div>

        {/* Each count is the filter for its own kind. None starts selected, so every claim shows. */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {kinds.map((kind) => {
            const active = filter === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onFilter(active ? null : kind)}
                aria-pressed={active}
                aria-label={verdictCountLabel(kind, counts[kind])}
                disabled={counts[kind] === 0}
                title={STANDING_MEANINGS[kind]}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-xl px-3.5 py-3 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  'disabled:cursor-default disabled:opacity-60',
                  active ? 'bg-accent-soft ring-2 ring-accent' : 'bg-neutral-soft enabled:hover:bg-accent-soft',
                )}
              >
                <span aria-hidden="true" className={cn('text-[26px] leading-8 font-semibold tracking-tight tabular-nums', COUNT_STYLES[kind])}>
                  {counts[kind]}
                </span>
                <span aria-hidden="true" className="text-xs leading-4 font-medium text-ink-muted">
                  {verdictCountWord(kind, counts[kind])}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}

function TeacherSummary({
  claims,
  standings,
  counts,
  filter,
  onFilter,
  paper,
  paperLabel,
  onOpenPaper,
  onTeacherFeedback,
}: SummaryProps & { paperLabel?: string; onTeacherFeedback?: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copyMarkdown() {
    await navigator.clipboard.writeText(toMarkdown(claims, paper))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="-mx-1 rounded-xl border border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur lg:sticky lg:top-0 lg:z-10">
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

        <div className="flex items-center gap-2">
          {paper && onOpenPaper && (
            <Button variant="ghost" onClick={onOpenPaper} title="Read the paper here, page by page">
              <FileText className="size-4" />
              PDF
            </Button>
          )}
          {onTeacherFeedback && (
            <Button className="bg-accent-soft text-ink hover:bg-accent-soft" variant="ghost" onClick={onTeacherFeedback} title="Write feedback for the student">
              <MessageSquarePlus className="size-4" />
              Feedback
            </Button>
          )}
          <Button variant="ghost" onClick={copyMarkdown} title="Copy every claim and verdict as markdown">
            <Copy className="size-4" />
            {copied ? 'Copied' : 'Copy all'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadText('claims.csv', toCsv(claims), 'text/csv;charset=utf-8')}
            title="Download the claims, their verdicts and their pages as CSV"
          >
            <Download className="size-4" />
            CSV
          </Button>
        </div>
      </div>

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
