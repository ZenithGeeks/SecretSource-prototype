/**
 * Find papers in Scopus by topic and add them to the labeling list. The search runs when the
 * labeler presses Search, not as they type: every page costs Scopus quota. Results come 25 at a
 * time, most cited first unless the labeler picks another order, and each opens to its abstract.
 */

import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ChevronDown, ExternalLink, Loader2, Plus, RotateCcw, SearchX } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { SearchField } from '../../../components/SearchField'
import { Button, Card, Input } from '../../../components/ui'
import {
  problem,
  TOPIC_INFO,
  useScopusAdd,
  useScopusSearch,
  type Pool,
  type ScopusPaper,
  type ScopusQuery,
  type ScopusSort,
} from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { GraphSegmented } from '../../researcher/components/GraphSegmented'
import { TopicSelect } from './TopicSelect'

const THIS_YEAR = new Date().getFullYear()
const FIRST_YEAR = 1990

const SORTS: { key: ScopusSort; label: string }[] = [
  { key: 'cited', label: 'Most cited' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'match', label: 'Best match' },
]

/** A year typed into a field, kept inside the years Scopus can be asked about. */
function clampYear(value: string, fallback: number) {
  const year = Number(value)
  if (!value.trim() || !Number.isInteger(year)) return fallback
  return Math.min(Math.max(year, FIRST_YEAR), THIS_YEAR)
}

/** The form as typed: the years stay text until a search, so a half-typed year is not undone. */
type Form = Omit<ScopusQuery, 'since' | 'until'> & { since: string; until: string }

export function ScopusAdd({ pool, myTopic }: { pool: Pool; myTopic: string }) {
  const [form, setForm] = useState<Form>({ topic: myTopic, q: '', since: '2020', until: String(THIS_YEAR), sort: 'cited' })
  // The search that is showing. The form can change without searching again.
  const [query, setQuery] = useState<ScopusQuery | null>(null)
  const [added, setAdded] = useState<Record<string, true>>({})
  const search = useScopusSearch(query)
  const add = useScopusAdd()

  const papers = search.data?.pages.flatMap((page) => page.results) ?? []
  const total = search.data?.pages[0]?.total ?? 0
  const set = (change: Partial<Form>) => setForm((current) => ({ ...current, ...change }))

  const run = (event?: FormEvent, next: Form = form) => {
    event?.preventDefault()
    if (!next.topic) return
    const since = clampYear(next.since, 2020)
    const until = Math.max(clampYear(next.until, THIS_YEAR), since)
    // "Best match" means nothing without words, so an empty search falls back to most cited.
    const sort = next.sort === 'match' && !next.q.trim() ? 'cited' : next.sort
    setForm({ ...next, since: String(since), until: String(until) })
    setQuery({ topic: next.topic, q: next.q.trim(), since, until, sort })
  }
  /** Changes the form and searches with it at once, for the empty state's suggestions. */
  const retryWith = (change: Partial<Form>) => {
    const next = { ...form, ...change }
    setForm(next)
    run(undefined, next)
  }

  return (
    <MotionConfig reducedMotion="user">
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Add papers from Scopus</h2>
          <p className="text-xs text-ink-muted">
            Open-access papers from the topic's conferences and journals
            {form.topic && TOPIC_INFO[form.topic] ? ` (${TOPIC_INFO[form.topic].venues}; ${TOPIC_INFO[form.topic].journal})` : ''}.
          </p>
        </div>

        <form onSubmit={run} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <SearchField
              label="Words in the title or abstract (optional)"
              value={form.q}
              onChange={(q) => set({ q })}
              placeholder="e.g. late interaction retrieval"
              busy={search.isFetching && !search.isFetchingNextPage}
              maxLength={100}
              className="min-w-56 flex-1"
            />
            <Button type="submit" disabled={!form.topic || search.isFetching} className="min-h-11">
              Search Scopus
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink">
              Topic
              <TopicSelect label="Topic to search" value={form.topic} topics={pool.topics} empty="Pick a topic" onChange={(topic) => set({ topic })} />
            </label>
            {/* A labelled group, not a fieldset: a legend sits lower than the other labels. */}
            <div role="group" aria-labelledby="scopus-years" className="flex flex-col gap-1.5">
              <span id="scopus-years" className="text-xs font-medium text-ink">
                Published
              </span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label="From year"
                  min={FIRST_YEAR}
                  max={THIS_YEAR}
                  value={form.since}
                  onChange={(e) => set({ since: e.target.value })}
                  className="min-h-11 w-24 tabular-nums"
                />
                <span className="text-xs text-ink-muted">to</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label="To year"
                  min={FIRST_YEAR}
                  max={THIS_YEAR}
                  value={form.until}
                  onChange={(e) => set({ until: e.target.value })}
                  className="min-h-11 w-24 tabular-nums"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">Order</span>
              {/* As tall as the inputs beside it, so the three labels line up. */}
              <div className="flex min-h-11 items-center">
                <GraphSegmented label="Order" value={form.sort} options={SORTS} onChange={(sort) => set({ sort })} />
              </div>
            </div>
          </div>
        </form>

        {search.isError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-refutes-soft px-3 py-2.5 text-sm text-refutes">
            <span>
              <span className="font-medium">{problem(search.error).title}.</span> {problem(search.error).hint}
            </span>
            <Button variant="ghost" onClick={() => search.refetch()} className="min-h-9 text-refutes">
              <RotateCcw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
        {add.isError && (
          <p role="alert" className="text-sm text-refutes">
            {problem(add.error).title}. {problem(add.error).hint}
          </p>
        )}

        {search.isPending && query && <ResultSkeleton />}

        {search.isSuccess && papers.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-subtle px-4 py-8 text-center">
            <SearchX className="size-5 text-ink-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-ink">Scopus has no open-access papers for that.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {query?.q && (
                <Button variant="ghost" onClick={() => retryWith({ q: '' })} className="min-h-9">
                  Search without the words
                </Button>
              )}
              {query && query.since > FIRST_YEAR && (
                <Button variant="ghost" onClick={() => retryWith({ since: '2010', until: String(THIS_YEAR) })} className="min-h-9">
                  Search 2010 to {THIS_YEAR}
                </Button>
              )}
            </div>
          </div>
        )}

        {papers.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-xs text-ink-muted tabular-nums" role="status">
              {total.toLocaleString()} papers · showing {papers.length}
            </p>
            <ul aria-label="Scopus results" className="flex flex-col divide-y divide-border-subtle">
              {papers.map((paper, index) => (
                <ResultRow
                  key={paper.doi}
                  paper={paper}
                  // Only the first 25 arrive together; later pages fade in on their own.
                  delay={index < 25 ? index * 0.03 : 0}
                  done={paper.added || Boolean(added[paper.doi])}
                  adding={add.isPending && add.variables?.doi === paper.doi}
                  onAdd={() =>
                    add.mutate(
                      { doi: paper.doi, topic: query?.topic ?? form.topic },
                      { onSuccess: () => setAdded((all) => ({ ...all, [paper.doi]: true })) },
                    )
                  }
                />
              ))}
            </ul>
            {search.hasNextPage && (
              <Button
                variant="ghost"
                onClick={() => search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
                className="min-h-11 self-center"
              >
                {search.isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Show 25 more
              </Button>
            )}
          </section>
        )}
      </Card>
    </MotionConfig>
  )
}

/** One paper: title, where and when it appeared, and Add. The title opens its abstract. */
function ResultRow({
  paper,
  delay,
  done,
  adding,
  onAdd,
}: {
  paper: ScopusPaper
  delay: number
  done: boolean
  adding: boolean
  onAdd: () => void
}) {
  const [open, setOpen] = useState(false)
  const cited = paper.cited_by ? `cited ${paper.cited_by.toLocaleString()}` : ''
  const meta = [paper.venue, paper.year, paper.first_author, cited].filter(Boolean).join(' · ')
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut', delay }}
      className="py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronDown
            className={cn('mt-0.5 size-4 shrink-0 text-ink-muted transition-transform duration-200', open && 'rotate-180')}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink group-hover:text-accent">{paper.title}</span>
            <span className="mt-0.5 block text-xs text-ink-muted tabular-nums [overflow-wrap:anywhere]">{meta}</span>
          </span>
        </button>
        <Button
          variant="ghost"
          className="min-h-11 shrink-0"
          disabled={done || adding}
          aria-label={`Add ${paper.title}`}
          onClick={onAdd}
        >
          {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : !done && <Plus className="size-4" aria-hidden="true" />}
          {done ? 'Added' : 'Add'}
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mt-2 ml-6 flex max-w-prose flex-col gap-2 border-l-2 border-accent/30 pl-4"
          >
            <p className="type-label text-ink-muted">Abstract · from OpenAlex</p>
            {paper.abstract ? (
              <Abstract text={paper.abstract} />
            ) : (
              <p className="text-[13px] text-ink-muted">OpenAlex has no abstract for this paper.</p>
            )}
            <a
              href={`https://doi.org/${paper.doi}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-6 items-center gap-1 self-start text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Open the paper's page
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/** An abstract in the paper's own typeface, four lines until the reader asks for the rest. */
function Abstract({ text }: { text: string }) {
  const [whole, setWhole] = useState(false)
  // About four lines at this width; a shorter abstract needs no button.
  const long = text.length > 420
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn('font-paper text-[16px] leading-[1.55] text-ink', long && !whole && 'line-clamp-4')}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setWhole(!whole)}
          aria-expanded={whole}
          className="min-h-6 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {whole ? 'Show less' : 'Read the whole abstract'}
        </button>
      )}
    </div>
  )
}

/** Three placeholder rows while the first page loads, so the card does not jump. */
function ResultSkeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col divide-y divide-border-subtle">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-start gap-3 py-3">
          <span className="mt-0.5 size-4 rounded bg-neutral-soft" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-3/4 animate-pulse rounded bg-neutral-soft" />
            <span className="h-3 w-1/2 animate-pulse rounded bg-neutral-soft" />
          </span>
        </li>
      ))}
    </ul>
  )
}
