/** The toolbar above the papers: search by title, filter by who, topic, status and progress. */

import { Search, X } from 'lucide-react'

import { FacetFilter, type FacetOption } from '../../../components/FacetFilter'
import { Button, Input } from '../../../components/ui'
import { countBy, FACET_LABELS, FACETS, isFiltered, NO_FILTERS, valueLabel, valueOf, type Facet, type Filters, type Paper } from '../paperFilters'

type Props = { papers: Paper[]; topics: string[]; me: string; filters: Filters; onChange: (next: Filters) => void }

/** Every value a filter can take: the fixed ones, plus any the papers have. */
function valuesFor(facet: Facet, papers: Paper[], topics: string[], me: string): string[] {
  if (facet === 'status') return ['done', 'running', 'error']
  if (facet === 'progress') return ['none', 'started', 'done']
  const seen = new Set(papers.map((paper) => valueOf(paper, facet, me)))
  if (facet === 'topic') return [...new Set([...topics, ...seen])]
  // You first, then by name; papers with no name last.
  return [...seen].sort((a, b) => Number(b === me) - Number(a === me) || Number(a === '') - Number(b === '') || a.localeCompare(b))
}

function optionsFor(facet: Facet, { papers, topics, me, filters }: Props): FacetOption[] {
  const counts = countBy(papers, filters, me, facet)
  return valuesFor(facet, papers, topics, me).map((value) => ({
    value,
    label: valueLabel(facet, value, me),
    count: counts.get(value) ?? 0,
  }))
}

export function PaperFilters(props: Props & { shown: number }) {
  const { papers, filters, onChange, shown } = props
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search titles and keywords</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <Input
            type="search"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Search titles and keywords"
            className="min-h-11 bg-surface pl-9"
          />
        </label>
        {FACETS.map((facet) => (
          <FacetFilter
            key={facet}
            label={FACET_LABELS[facet]}
            options={optionsFor(facet, props)}
            selected={filters[facet]}
            onChange={(next) => onChange({ ...filters, [facet]: next })}
          />
        ))}
        {isFiltered(filters) && (
          <Button variant="ghost" className="min-h-11 px-3" onClick={() => onChange(NO_FILTERS)}>
            <X className="size-4" aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>
      <p role="status" aria-atomic="true" className="text-xs text-ink-muted tabular-nums">
        {shown === papers.length ? `${papers.length} papers` : `${shown} of ${papers.length} papers`}
      </p>
    </div>
  )
}

/** Shown in place of the table when the filters leave nothing. */
export function NoMatch({ filters, me, onClear }: { filters: Filters; me: string; onClear: () => void }) {
  const active = [
    ...(filters.search.trim() ? [`Title has "${filters.search.trim()}"`] : []),
    ...FACETS.filter((facet) => filters[facet].length > 0).map(
      (facet) => `${FACET_LABELS[facet]}: ${filters[facet].map((value) => valueLabel(facet, value, me)).join(' or ')}`,
    ),
  ]
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-subtle px-6 py-10 text-center">
      <div>
        <p className="font-medium">No papers match these filters</p>
        <p className="mt-1 text-sm text-ink-muted">{active.join(' · ')}</p>
      </div>
      <Button variant="ghost" className="min-h-11" onClick={onClear}>
        <X className="size-4" aria-hidden="true" />
        Clear filters
      </Button>
    </div>
  )
}
