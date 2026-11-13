/**
 * Find papers in Scopus by topic and add them to the labeling list. The search runs when the
 * labeler presses Search, not as they type: every page costs Scopus quota. Results come 25 at a
 * time, most cited first unless the labeler picks another order, and each opens to its abstract.
 */

import { AnimatePresence, m, MotionConfig } from 'framer-motion'
import { ChevronDown, ExternalLink, Loader2, Plus, RotateCcw, SearchX } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { SearchField } from '../../../components/SearchField'
import { Button, Card, Input, TextButton } from '../../../components/ui'
import {
  problem,
  TOPIC_INFO,
  useScopusAdd,
  useScopusSearch,
  useUploadPaper,
  type Pool,
  type RankFilter,
  type ScopusPaper,
  type ScopusQuery,
  type ScopusScope,
  type ScopusSort,
} from '../../../lib/labeling'
import { OFFLINE_REASON, useFeature } from '../../../lib/features'
import { cn } from '../../../lib/utils'
import { GraphSegmented } from '../../researcher/components/GraphSegmented'
import { PaperKeywords } from './PaperKeywords'
import { TopicSelect } from './TopicSelect'
import { UploadPdfButton } from './UploadPdfButton'
import { VenueRankBadge } from './VenueRankBadge'

const THIS_YEAR = new Date().getFullYear()
const FIRST_YEAR = 1990

const SORTS: { key: ScopusSort; label: string }[] = [
  { key: 'cited', label: 'Most cited' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'match', label: 'Best match' },
]

const SCOPES: { key: ScopusScope; label: string }[] = [
  { key: 'topic', label: 'Topic venues' },
  { key: 'all', label: 'All of Scopus' },
]

const RANKS: { key: RankFilter; label: string }[] = [
  { key: 'any', label: 'Any' },
  { key: 'top', label: 'Q1 / A*' },
  { key: 'upper', label: 'Q1–Q2 / A*–A' },
]

/** A DOI on its own or inside a paper link; the gateway then looks up only that paper. */
const DOI = /\b10\.\d{4,9}\/\S+/

/** A year typed into a field, kept inside the years Scopus can be asked about. */
function clampYear(value: string, fallback: number) {
  const year = Number(value)
  if (!value.trim() || !Number.isInteger(year)) return fallback
  return Math.min(Math.max(year, FIRST_YEAR), THIS_YEAR)
}

function emptyMessage(hidden: number, byDoi: boolean): string {
  if (hidden > 0) return `The venue rank filter hid all ${hidden} papers Scopus sent so far.`
  if (byDoi) return 'Scopus has no paper with that DOI.'
  return 'Scopus has no open-access papers for that.'
}

/** The form as typed: the years stay text until a search, so a half-typed year is not undone. */
type Form = Omit<ScopusQuery, 'since' | 'until'> & { since: string; until: string }

export function ScopusAdd({ pool, myTopic }: { pool: Pool; myTopic: string }) {
  const [form, setForm] = useState<Form>({
    topic: myTopic,
    scope: 'topic',
    q: '',
    since: '2020',
    until: String(THIS_YEAR),
    sort: 'cited',
    rank: 'any',
  })
  // The search that is showing. The form can change without searching again.
  const [query, setQuery] = useState<ScopusQuery | null>(null)
  const [added, setAdded] = useState<Record<string, true>>({})
  const search = useScopusSearch(query)
  const add = useScopusAdd()
  const upload = useUploadPaper(({ doi }) => doi && setAdded((all) => ({ ...all, [doi]: true })))
  const online = useFeature('analyses')

  const papers = search.data?.pages.flatMap((page) => page.results) ?? []
  const total = search.data?.pages[0]?.total ?? 0
  const hidden = search.data?.pages.reduce((sum, page) => sum + (page.hidden ?? 0), 0) ?? 0
  const set = (change: Partial<Form>) => setForm((current) => ({ ...current, ...change }))
  // A DOI search ignores words, years and venues, so the empty state's suggestions do not apply.
  const byDoi = query ? DOI.test(query.q) : false

  const run = (event?: FormEvent, next: Form = form) => {
    event?.preventDefault()
    if (!next.topic) return
    const since = clampYear(next.since, 2020)
    const until = Math.max(clampYear(next.until, THIS_YEAR), since)
    // "Best match" means nothing without words, so an empty search falls back to most cited.
    const sort = next.sort === 'match' && !next.q.trim() ? 'cited' : next.sort
    setForm({ ...next, since: String(since), until: String(until) })
    setQuery({ topic: next.topic, scope: next.scope, q: next.q.trim(), since, until, sort, rank: next.rank })
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
            {form.scope === 'all'
              ? 'Open-access papers from any conference or journal. An added paper is filed under the topic you pick.'
              : `Open-access papers from the topic's conferences and journals${
                  form.topic && TOPIC_INFO[form.topic] ? ` (${TOPIC_INFO[form.topic].venues}; ${TOPIC_INFO[form.topic].journal})` : ''
                }.`}{' '}
            Paste a DOI or a paper link to find that one paper.
          </p>
        </div>

        <form onSubmit={run} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <SearchField
              label="Words in the title or abstract, or a DOI or link (optional)"
              value={form.q}
              onChange={(q) => set({ q })}
              placeholder="e.g. late interaction retrieval"
              busy={search.isFetching && !search.isFetchingNextPage}
              // Room for a long paper link; the gateway keeps the first 100 characters of words.
              maxLength={300}
              className="min-w-56 flex-1"
            />
            <Button type="submit" disabled={!form.topic || search.isFetching} className="min-h-11">
              Search Scopus
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">Search in</span>
              <div className="flex min-h-11 items-center">
                <GraphSegmented label="Search in" value={form.scope} options={SCOPES} onChange={(scope) => set({ scope })} />
              </div>
            </div>
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
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink" title="Journals by CiteScore quartile, conferences by CORE rank">
                Venue rank
              </span>
              <div className="flex min-h-11 items-center">
                <GraphSegmented label="Venue rank" value={form.rank} options={RANKS} onChange={(rank) => set({ rank })} />
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
        {!online && (
          <p role="status" className="text-sm text-refutes">
            {OFFLINE_REASON.analyses}
          </p>
        )}
        {add.isError && (
          <p role="alert" className="text-sm text-refutes">
            {problem(add.error).title}. {problem(add.error).hint}
          </p>
        )}
        {upload.isError && (
          <p role="alert" className="text-sm text-refutes">
            The PDF was not added: {problem(upload.error).title}. {problem(upload.error).hint}
          </p>
        )}

        {search.isPending && query && <ResultSkeleton />}

        {search.isSuccess && papers.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-subtle px-4 py-8 text-center">
            <SearchX className="size-5 text-ink-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-ink">
              {emptyMessage(hidden, byDoi)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {hidden > 0 && search.hasNextPage && (
                <Button variant="ghost" onClick={() => search.fetchNextPage()} disabled={search.isFetchingNextPage} className="min-h-9">
                  Look at the next 25
                </Button>
              )}
              {query && query.rank !== 'any' && (
                <Button variant="ghost" onClick={() => retryWith({ rank: 'any' })} className="min-h-9">
                  Any venue rank
                </Button>
              )}
              {query?.scope === 'topic' && !byDoi && (
                <Button variant="ghost" onClick={() => retryWith({ scope: 'all' })} className="min-h-9">
                  Search all of Scopus
                </Button>
              )}
              {query?.q && !byDoi && (
                <Button variant="ghost" onClick={() => retryWith({ q: '' })} className="min-h-9">
                  Search without the words
                </Button>
              )}
              {query && !byDoi && query.since > FIRST_YEAR && (
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
              {hidden > 0 && ` · ${hidden} hidden by the venue rank filter`}
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
                  uploading={upload.isPending && upload.variables?.doi === paper.doi}
                  // One upload at a time: the progress shown is the latest upload's only.
                  uploadBlocked={upload.isPending}
                  online={online}
                  onAdd={() =>
                    add.mutate(
                      // A result is only listed after a search, so `query` is set; `form.topic` only satisfies the type.
                      /* v8 ignore next -- @preserve */
                      { doi: paper.doi, topic: query?.topic ?? form.topic },
                      { onSuccess: () => setAdded((all) => ({ ...all, [paper.doi]: true })) },
                    )
                  }
                  /* v8 ignore next -- @preserve */
                  onUpload={(file) => upload.mutate({ file, topic: query?.topic ?? form.topic, doi: paper.doi })}
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
  uploading,
  uploadBlocked,
  online,
  onAdd,
  onUpload,
}: {
  paper: ScopusPaper
  delay: number
  done: boolean
  adding: boolean
  uploading: boolean
  uploadBlocked: boolean
  /** An analysis can start now; when not, neither Add nor an upload is offered. */
  online: boolean
  onAdd: () => void
  /** The labeler's own copy of the PDF, for a paper the analysis cannot download or reads badly. */
  onUpload: (file: File) => void
}) {
  const [open, setOpen] = useState(false)
  const cited = paper.cited_by ? `cited ${paper.cited_by.toLocaleString()}` : ''
  const meta = [paper.venue, paper.year, paper.first_author, cited].filter(Boolean).join(' · ')
  // false: the only copy is on a site that refuses scripts, so the paper could never be read.
  // null: it could not be checked, so adding stays allowed.
  const unreachable = paper.downloadable === false && !done
  return (
    <m.li
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
          <span className={cn('min-w-0', unreachable && 'opacity-60')}>
            <span className="block text-sm font-medium text-ink group-hover:text-accent">{paper.title}</span>
            <span className="mt-0.5 block text-xs text-ink-muted tabular-nums [overflow-wrap:anywhere]">{meta}</span>
          </span>
        </button>
        {unreachable ? (
          <span className="flex shrink-0 flex-col items-end">
            <UploadPdfButton title={paper.title} busy={uploading} disabled={uploadBlocked || !online} onFile={onUpload} />
            <span className="text-xs text-ink-muted">No copy we can download</span>
          </span>
        ) : (
          <span className="flex shrink-0 flex-col items-end sm:flex-row sm:items-center">
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={done || adding || uploading || !online}
              aria-label={`Add ${paper.title}`}
              onClick={onAdd}
            >
              {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : !done && <Plus className="size-4" aria-hidden="true" />}
              {done ? 'Added' : 'Add'}
            </Button>
            {!done && (
              <UploadPdfButton title={paper.title} busy={uploading} disabled={adding || uploadBlocked || !online} onFile={onUpload} />
            )}
          </span>
        )}
      </div>
      <div className={cn('mt-1.5 ml-6 flex flex-wrap items-center gap-1', unreachable && 'opacity-60')}>
        {paper.rank && (
          <VenueRankBadge
            value={paper.rank.value}
            source={paper.rank.system ? `${paper.rank.system} ${paper.rank.year}` : ''}
          />
        )}
        <PaperKeywords subject={paper.subject} keywords={paper.keywords} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
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
          </m.div>
        )}
      </AnimatePresence>
    </m.li>
  )
}

/** An abstract in the paper's own typeface, four lines until the reader asks for the rest. */
function Abstract({ text }: { text: string }) {
  const [whole, setWhole] = useState(false)
  // About four lines at this width; a shorter abstract needs no button.
  const long = text.length > 420
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn('font-paper text-[15px] leading-relaxed text-ink', long && !whole && 'line-clamp-4')}>{text}</p>
      {long && (
        <TextButton onClick={() => setWhole(!whole)} aria-expanded={whole} className="min-h-6 text-xs">
          {whole ? 'Show less' : 'Read the whole abstract'}
        </TextButton>
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
