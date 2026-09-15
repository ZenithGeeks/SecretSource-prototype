/** The first ten seconds: how this paper's citations came out, and a way to narrow to one kind. */

import { Copy, Download, FileText } from 'lucide-react'
import { useState } from 'react'

import { STANDING_LABELS, STANDING_MEANINGS, STANDINGS, toCsv, toMarkdown } from '../lib/claims'
import type { Standing, Standings } from '../lib/claims'
import type { Claim } from '../lib/api'
import { cn } from '../lib/utils'
import { downloadText } from '../lib/csv'
import { Button } from './ui'

/** Muted for the two standings that are not a verdict, so a colour always means an answer. */
const COUNT_STYLES: Record<Standing, string> = {
  refutes: 'text-refutes',
  insufficient: 'text-insufficient',
  supports: 'text-supports',
  unchecked: 'text-ink-muted',
  uncited: 'text-ink-muted',
}

export function ResultsSummary({
  claims,
  standings,
  counts,
  filter,
  onFilter,
  paper,
  onOpenPaper,
}: {
  claims: Claim[]
  standings: Standings
  counts: Record<Standing, number>
  filter: Standing | null
  onFilter: (standing: Standing | null) => void
  paper?: string
  /** Opens the paper in the page viewer beside the claims; without it the button links to the file. */
  onOpenPaper?: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyMarkdown() {
    await navigator.clipboard.writeText(toMarkdown(claims, paper))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="sticky top-0 z-10 -mx-1 rounded-xl border border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={paper}>
            {paper ?? 'This paper'}
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
              The PDF
            </Button>
          )}
          {paper && !onOpenPaper && (
            <a
              href={`/api/papers/${encodeURIComponent(paper)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <FileText className="size-4" />
              The PDF
            </a>
          )}
          <Button variant="ghost" onClick={copyMarkdown} title="Copy every claim and verdict as markdown">
            <Copy className="size-4" />
            {copied ? 'Copied' : 'Copy'}
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
