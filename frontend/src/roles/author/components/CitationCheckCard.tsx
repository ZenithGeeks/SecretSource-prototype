/** "Citations that need work" (Redesign A1): the filter chips and the rows. Clicking a row selects
 * it for the Evidence panel below. "Needs work" lists the open issues worst first (Source
 * contradicts, then Source is silent), then what could not be judged under a collapsible
 * "N couldn't be checked", so a source nobody could read is not hidden but does not bury the
 * issues either; those rows are not open issues (isOpenIssue). */

import { ChevronDown } from 'lucide-react'
import { Fragment, useId, useState } from 'react'

import { Card, Empty } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { preprintNote, shortMessage } from '../../../lib/citations'
import { cn } from '../../../lib/utils'
import { VERDICTS, bySeverity, isLowConfidence, isNotFound, isOpenIssue, isUnjudged, settledHint } from '../../../lib/verdict'
import type { Citation, Draft } from '../../../types/draftCheck'
import { CardHead } from './CardHead'
import { CitationBadge } from './Verdicts'
import { FOCUS } from '../hover'

type Filter = 'needs-work' | 'all' | 'by-section' | 'low-confidence'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'needs-work', label: 'Needs work' },
  { id: 'all', label: 'All' },
  { id: 'by-section', label: 'By section' },
  { id: 'low-confidence', label: 'Low confidence' },
]

const unjudged = (c: Citation) => isUnjudged(c) && !c.resolution

function rowsFor(filter: Filter, citations: Citation[]): Citation[] {
  switch (filter) {
    case 'needs-work':
      return bySeverity(citations.filter((c) => isOpenIssue(c) || unjudged(c)))
    case 'low-confidence':
      return citations.filter(isLowConfidence)
    default:
      return citations
  }
}

/** What the "Needs work" rows are, by the words and counts of statusLabel: its issues are the same
 * number as the Evidence pager and "Your drafts", and the rest are named for what they are. */
function needsWorkLabel(citations: Citation[]): string {
  const issues = citations.filter(isOpenIssue).length
  const unread = (verdict: Citation['verdict']) => citations.filter((c) => c.verdict === verdict && unjudged(c)).length
  const unavailable = unread('unavailable')
  const unchecked = unread('unchecked')
  return [`${issues} issue${issues === 1 ? '' : 's'}`, unavailable && `${unavailable} unavailable`, unchecked && `${unchecked} not checked`].filter(Boolean).join(' · ')
}

/** The mono line under a claim: where the \cite is, then where the verdict rests or why there is none. */
function rowNote(c: Citation): string {
  const at = `${c.file} · L${c.line}`
  if (c.resolution?.kind === 'replaced') return `${at} · replaced ${c.resolution.previousKey}`
  if (c.resolution?.kind === 'overridden') return `${at} · kept, with a note`
  // A source that was read exists, so then the DOI or title is what is likely wrong (#421).
  if (c.exists === 'no') {
    const read = c.verdict !== 'unavailable' && c.verdict !== 'unchecked'
    const what = c.lookedUpBy === 'title' ? 'title' : 'DOI'
    const where = c.lookedUpBy === 'title' ? 'in no index' : 'not in Crossref or OpenAlex'
    return `${at} · ${what} ${where}: ${read ? `check the ${what}` : 'check that it exists'}`
  }
  if (c.verdict === 'unavailable') return `${at} · ${shortMessage(c.message) || 'source PDF unavailable'}`
  if (c.verdict === 'unchecked') return `${at} · ${c.reason === 'missing-key' ? 'no bib entry' : 'not checked yet'}`
  // A passage can be quoted with no page known (the verdict's own quote, no located evidence).
  // A preprint's text can differ from the published paper, so the row says which one was read (#424).
  const preprint = c.sourceVersion === 'preprint' ? ` · ${preprintNote(c.arxiv)}` : ''
  if (c.evidence?.passage) {
    const where = [c.evidence.pdf, c.evidence.page ? `p.${c.evidence.page}` : ''].filter(Boolean).join(' ')
    return `${at} · ${where || 'passage quoted'}${preprint}`
  }
  return `${at} · no passage quoted${preprint}`
}

function CitationRow({ citation, selected, onSelect }: { citation: Citation; selected: boolean; onSelect: () => void }) {
  const note = rowNote(citation)
  return (
    <li className="border-t border-border-subtle">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        data-ask-target={askTarget({ kind: 'citation', id: citation.id })}
        className={cn(
          'flex w-full min-w-0 flex-col items-start gap-1.5 px-5 py-3 text-left transition-colors hover:bg-accent-soft/40',
          FOCUS,
          selected && 'bg-accent-soft/60',
        )}
      >
        <span className="flex max-w-full min-w-0 items-center gap-2">
          <CitationBadge verdict={citation.verdict} notFound={isNotFound(citation)} />
          <span className={cn('min-w-0 truncate font-mono text-xs', VERDICTS[citation.verdict].text)}>{`\\cite{${citation.key}}`}</span>
        </span>
        <span className="max-w-full text-[15px] leading-6 break-words text-ink">{citation.claim}</span>
        <span title={note} className="max-w-full truncate font-mono text-xs text-ink-muted">
          {note}
        </span>
      </button>
    </li>
  )
}

export function CitationCheckCard({
  draft,
  citations,
  selectedId,
  onSelect,
  checking,
  notJudged,
}: {
  draft: Draft
  citations: Citation[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  /** A re-check is running: the rows shown are the previous check's. */
  checking?: boolean
  /** No verdicts to show yet (title, hint): before a first check, or while they load. */
  notJudged?: [string, string]
}) {
  const [filter, setFilter] = useState<Filter>('needs-work')
  const rows = rowsFor(filter, citations)
  // "Needs work": the issues, then what could not be judged. That group opens by itself when there
  // is no issue above it, or when the selected row is in it; the author's own toggle wins.
  const issueRows: Citation[] = []
  const unreadRows: Citation[] = []
  for (const c of rows) (isOpenIssue(c) ? issueRows : unreadRows).push(c)
  // The author's toggle holds until the selection changes, so a row picked from elsewhere (the
  // pager, Ask) is never selected inside a closed group.
  const [toggled, setToggled] = useState<{ open: boolean; selectedId: string | undefined } | null>(null)
  const showUnread =
    toggled && toggled.selectedId === selectedId ? toggled.open : issueRows.length === 0 || unreadRows.some((c) => c.id === selectedId)
  const unreadId = useId()

  const emptyHint: Record<Filter, [string, string]> = {
    'needs-work': ['Nothing needs work', settledHint(draft.status)],
    all: ['No citations yet', 'Add a \\cite to your draft and re-check.'],
    'by-section': ['No citations yet', 'Add a \\cite to your draft and re-check.'],
    'low-confidence': ['No low-confidence verdicts', 'Every verdict points at a passage in its source.'],
  }

  // "By section" groups the rows under their section heading, in reading order.
  const sections = filter === 'by-section' ? [...new Set(rows.map((c) => c.section || c.file))] : []

  return (
    <Card className="flex min-w-0 flex-col gap-3 rounded-2xl p-0 pt-5" aria-labelledby="citation-check-title">
      <div className="flex flex-col gap-3 px-5">
        <CardHead
          id="citation-check-title"
          title={filter === 'needs-work' ? 'Citations that need work' : 'Citations'}
          aside={checking && <span className="text-accent">checking…</span>}
        />
        {!notJudged && (
          <p className="text-xs text-ink-muted">{filter === 'needs-work' ? needsWorkLabel(citations) : `${rows.length} citation${rows.length === 1 ? '' : 's'}`}</p>
        )}
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                FOCUS,
                filter === f.id ? 'bg-accent-soft font-medium text-accent' : 'bg-canvas text-ink-muted hover:bg-accent-soft hover:text-ink',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 pb-5">
          <Empty title={(notJudged ?? emptyHint[filter])[0]} hint={(notJudged ?? emptyHint[filter])[1]} />
        </div>
      ) : filter === 'by-section' ? (
        <ul aria-label="Citations by section" className="pb-1.5">
          {sections.map((section) => (
            <Fragment key={section}>
              <li className="px-5 pt-2 pb-1 text-[11px] font-medium tracking-wide break-words text-ink-muted uppercase">{section}</li>
              {rows
                .filter((c) => (c.section || c.file) === section)
                .map((c) => (
                  <CitationRow key={c.id} citation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
                ))}
            </Fragment>
          ))}
        </ul>
      ) : filter === 'needs-work' ? (
        <div className="pb-1.5">
          {issueRows.length > 0 && (
            <ul aria-label="Citations">
              {issueRows.map((c) => (
                <CitationRow key={c.id} citation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
              ))}
            </ul>
          )}
          {unreadRows.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setToggled({ open: !showUnread, selectedId })}
                aria-expanded={showUnread}
                aria-controls={unreadId}
                className={cn(
                  'flex w-full items-center gap-1.5 border-t border-border-subtle px-5 py-2.5 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-accent-soft/40 hover:text-ink',
                  FOCUS,
                )}
              >
                <ChevronDown className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', !showUnread && '-rotate-90')} aria-hidden="true" />
                {unreadRows.length} couldn’t be checked
              </button>
              <ul id={unreadId} hidden={!showUnread} aria-label="Citations that couldn’t be checked">
                {unreadRows.map((c) => (
                  <CitationRow key={c.id} citation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <ul aria-label="Citations" className="pb-1.5">
          {rows.map((c) => (
            <CitationRow key={c.id} citation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
          ))}
        </ul>
      )}
    </Card>
  )
}
