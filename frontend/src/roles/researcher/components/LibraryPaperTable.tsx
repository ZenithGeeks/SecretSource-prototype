/** The Library paper table (Figma: Library, table). One row per analysed paper. */

import { ChevronRight } from 'lucide-react'

import { verdictCountLabel } from '../../../lib/claims'
import type { LibraryPaper } from '../../../lib/researcher'
import { cn } from '../../../lib/utils'
import { count } from './LibraryCount'

const MARKER =
  'shrink-0 rounded-full border border-dashed border-insufficient px-[7px] py-px text-xs font-medium text-insufficient'

/** Backed / silent-or-unchecked / contradicted as one thin bar. The words sit beside it, so
 * colour is never the only signal. */
function StandingBar({ paper }: { paper: LibraryPaper }) {
  if (paper.backed === null) return <span className="text-[13px] text-ink-muted">Not analyzed</span>
  const backed = paper.backed
  const contradicted = paper.contradicted ?? 0
  const rest = Math.max(0, paper.claims - backed - contradicted)
  const parts = [
    { key: 'backed', n: backed, color: 'bg-supports' },
    { key: 'rest', n: rest, color: 'bg-neutral-soft' },
    { key: 'contradicted', n: contradicted, color: 'bg-refutes' },
  ].filter((p) => p.n > 0)
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-1.5 w-28 shrink-0 gap-0.5 overflow-hidden" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} className={cn('h-full rounded-[3px]', p.color)} style={{ flexGrow: p.n }} />
        ))}
      </span>
      <span className={cn('text-xs', contradicted > 0 ? 'font-semibold text-refutes' : 'text-ink-muted')}>
        {contradicted > 0
          ? verdictCountLabel('refutes', contradicted)
          : backed > 0
            ? verdictCountLabel('supports', backed)
            : verdictCountLabel('insufficient', rest)}
      </span>
    </span>
  )
}

export function LibraryPaperTable({
  papers,
  hasClusters,
  emptyText,
  limit,
  onOpen,
  expanded,
  onExpand,
}: {
  papers: LibraryPaper[]
  hasClusters: boolean
  emptyText: string
  /** Rows beyond this many wait behind "Show all". */
  limit: number
  onOpen: (id: string) => void
  expanded: boolean
  onExpand: () => void
}) {
  const visible = expanded ? papers : papers.slice(0, limit)
  return (
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
      <div className="type-label hidden items-center gap-5 px-5 py-3 text-ink-muted md:flex">
        <span className="min-w-0 flex-1">Paper</span>
        <span className="w-16 shrink-0">Claims</span>
        <span className="w-56 shrink-0">Standing</span>
        {hasClusters && <span className="w-36 shrink-0">Cluster</span>}
        <span className="w-4 shrink-0" />
      </div>
      {visible.map((paper) => (
        <button
          key={paper.id}
          type="button"
          onClick={() => onOpen(paper.id)}
          title="Open this analysis"
          className="flex w-full items-center gap-5 border-t border-border-subtle px-5 py-3 text-left hover:bg-accent-soft"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{paper.title}</p>
            <p className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              <span>{paper.cite}</span>
              {paper.indexed === 'no' && (
                <span className={MARKER} title="This paper was not found in Semantic Scholar, arXiv, or Unpaywall.">
                  Not found in a public index
                </span>
              )}
              {paper.sourcesNotIndexed > 0 && (
                <span
                  className={MARKER}
                  title={`${paper.sourcesNotIndexed} cited ${paper.sourcesNotIndexed === 1 ? 'source is' : 'sources are'} not in a public index`}
                >
                  Sources not in a public index
                </span>
              )}
              {paper.linked.length > 0 && (
                <span className="truncate text-accent">Linked to {paper.linked.join(', ')}</span>
              )}
            </p>
            {/* On a phone the columns do not fit, so they read as one line here. */}
            <p className="mt-1 text-xs text-ink-muted md:hidden">
              {count(paper.claims, 'claim')}
              {paper.backed === null ? ' · Not analyzed' : null}
            </p>
          </div>
          <span className="hidden w-16 shrink-0 font-mono text-[13px] text-ink md:inline">{paper.claims}</span>
          <span className="hidden w-56 shrink-0 md:inline">
            <StandingBar paper={paper} />
          </span>
          {hasClusters && (
            <span className="hidden w-36 shrink-0 text-[13px] text-ink-muted md:inline">{paper.cluster}</span>
          )}
          <ChevronRight className="size-4 shrink-0 text-ink-muted" />
        </button>
      ))}
      {papers.length === 0 && (
        <p className="border-t border-border-subtle px-5 py-6 text-sm text-ink-muted">{emptyText}</p>
      )}
      {!expanded && papers.length > limit && (
        <button
          type="button"
          onClick={onExpand}
          className="w-full border-t border-border-subtle px-5 py-3 text-left text-[13px] font-medium text-accent hover:bg-accent-soft"
        >
          Show all {papers.length} papers
        </button>
      )}
    </div>
  )
}
