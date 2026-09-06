/**
 * 11 Library (Researcher) — the researcher's papers, clustered by meaning, with per-paper
 * claim tallies. Data comes from useResearcherLibrary (mock-backed until the gateway
 * endpoint exists); the cluster chips filter the table locally.
 */

import { ChevronRight, Plus, Upload } from 'lucide-react'
import { useState } from 'react'

import { Button, Input } from '../../../components/ui'
import { useResearcherLibrary } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'

/** Cluster dot colours, cycled in cluster order so new clusters stay distinguishable. */
const DOT_COLORS = ['bg-accent', 'bg-supports', 'bg-insufficient', 'bg-ink-muted', 'bg-refutes']

export function Library() {
  const [filter, setFilter] = useState('All')
  const library = useResearcherLibrary().data
  if (!library) return null

  const dotFor = (cluster: string) => {
    const names = [...new Set(library.papers.map((p) => p.cluster))]
    return DOT_COLORS[names.indexOf(cluster) % DOT_COLORS.length]
  }

  const shown = library.papers.filter((p) =>
    filter === 'All' ? true
    : filter === 'Unverified' ? p.backed === null
    : p.cluster === filter,
  )

  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Library</h1>
          <p className="text-sm text-ink-muted">{library.summary}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost">
            <Upload className="size-4" />
            Import .bib
          </Button>
          <Button>
            <Plus className="size-4" />
            Add paper
          </Button>
        </div>
      </header>

      {/* Search + cluster filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search by meaning, e.g. “compression of token embeddings”" className="max-w-xl" />
        <div className="flex flex-wrap gap-2">
          {library.clusters.map((cluster) => (
            <button
              key={cluster}
              type="button"
              onClick={() => setFilter(cluster)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium text-ink',
                filter === cluster
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-subtle hover:border-accent',
              )}
            >
              {cluster}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <div className="flex items-center gap-4 px-5 py-2.5 text-xs font-medium text-ink-muted">
          <span className="flex-1">Paper</span>
          <span className="w-36 shrink-0">Cluster</span>
          <span className="w-16 shrink-0">Claims</span>
          <span className="w-16 shrink-0">Backed</span>
          <span className="w-24 shrink-0">Contradicted</span>
          <span className="w-40 shrink-0">Linked to</span>
          <span className="w-6 shrink-0" />
        </div>
        {shown.map((paper) => (
          <button
            key={paper.title}
            type="button"
            className="flex w-full items-center gap-4 border-t border-border-subtle px-5 py-2.5 text-left hover:bg-accent-soft"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{paper.title}</p>
              <p className="text-xs text-ink-muted">{paper.cite}</p>
            </div>
            <span className="flex w-36 shrink-0 items-center gap-1.5 text-xs text-ink-muted">
              <span className={cn('size-2 rounded-full', dotFor(paper.cluster))} />
              {paper.cluster}
            </span>
            <span className="w-16 shrink-0 text-sm font-medium text-ink">{paper.claims}</span>
            <span className="w-16 shrink-0 text-sm font-medium text-supports">{paper.backed ?? '—'}</span>
            <span className="w-24 shrink-0 text-sm font-medium text-refutes">{paper.contradicted ?? '—'}</span>
            <span className="w-40 shrink-0 truncate text-xs text-accent">{paper.linked.join(', ')}</span>
            <ChevronRight className="size-4 shrink-0 text-ink-muted" />
          </button>
        ))}
      </div>
    </>
  )
}
