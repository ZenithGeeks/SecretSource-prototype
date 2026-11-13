/**
 * Filters for the list of papers the team added. The list is small, so everything runs in
 * the browser. Values within one filter combine with OR; different filters combine with AND.
 */

import type { Pool } from '../../lib/labeling'

export type Paper = Pool['papers'][number]

export const isFinished = (paper: Paper) => paper.status === 'done' && paper.claims > 0 && paper.judged >= paper.claims

export const STATUS_LABELS: Record<Paper['status'], string> = { done: 'Ready', running: 'Reading', error: 'Could not be read' }

export const PROGRESS_LABELS = { none: 'Not started', started: 'Started', done: 'Done' } as const

export function progressOf(paper: Paper): keyof typeof PROGRESS_LABELS {
  if (isFinished(paper)) return 'done'
  return paper.judged > 0 ? 'started' : 'none'
}

/** Who shared the paper. Older papers of your own may have no name, so `mine` fills it in. */
export const addedByOf = (paper: Paper, me: string) => paper.added_by || (paper.mine ? me : '')

/** Whether the whole team, not just the viewer, has judged every claim — for the summary card
 * shown once "Added by" is narrowed to one person (not a filter of its own). */
export function teamStatusOf(paper: Paper): keyof typeof PROGRESS_LABELS {
  if (paper.status === 'done' && paper.claims > 0 && paper.team_judged >= paper.claims) return 'done'
  return paper.team_judged > 0 ? 'started' : 'none'
}

export type Facet = 'addedBy' | 'topic' | 'status' | 'progress'
export type Filters = { search: string } & Record<Facet, string[]>

export const FACETS: Facet[] = ['addedBy', 'topic', 'status', 'progress']
export const FACET_LABELS: Record<Facet, string> = { addedBy: 'Added by', topic: 'Topic', status: 'Status', progress: 'My progress' }
export const NO_FILTERS: Filters = { search: '', addedBy: [], topic: [], status: [], progress: [] }

export function valueOf(paper: Paper, facet: Facet, me: string): string {
  if (facet === 'addedBy') return addedByOf(paper, me)
  if (facet === 'topic') return paper.topic
  if (facet === 'status') return paper.status
  return progressOf(paper)
}

/** `skip` leaves one filter out, to count what each of its values would show. The search words
 * match the title, the subject or a keyword. */
export function matches(paper: Paper, filters: Filters, me: string, skip?: Facet): boolean {
  const words = filters.search.trim().toLowerCase()
  const text = [paper.title, paper.subject, ...paper.keywords].join('\n').toLowerCase()
  if (words && !text.includes(words)) return false
  return FACETS.every((facet) => facet === skip || filters[facet].length === 0 || filters[facet].includes(valueOf(paper, facet, me)))
}

/** How many papers each value of `facet` would show, given the other filters. */
export function countBy(papers: Paper[], filters: Filters, me: string, facet: Facet): Map<string, number> {
  const counts = new Map<string, number>()
  for (const paper of papers) {
    if (!matches(paper, filters, me, facet)) continue
    const value = valueOf(paper, facet, me)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

export const isFiltered = (filters: Filters) => filters.search.trim() !== '' || FACETS.some((facet) => filters[facet].length > 0)

/** The words for one value, as the filter buttons show it. */
export function valueLabel(facet: Facet, value: string, me: string): string {
  if (facet === 'addedBy') return value === me ? 'You' : value || 'Unknown'
  if (facet === 'status') return STATUS_LABELS[value as Paper['status']] ?? value
  if (facet === 'progress') return PROGRESS_LABELS[value as keyof typeof PROGRESS_LABELS] ?? value
  return value
}

// The filters live in the address bar, so they survive opening a paper and coming back.
const PARAMS: Record<keyof Filters, string> = { search: 'q', addedBy: 'by', topic: 'topic', status: 'status', progress: 'progress' }

export function readFilters(query: string): Filters {
  const params = new URLSearchParams(query)
  return {
    search: params.get(PARAMS.search) ?? '',
    addedBy: params.getAll(PARAMS.addedBy),
    topic: params.getAll(PARAMS.topic),
    status: params.getAll(PARAMS.status).filter((v) => Object.hasOwn(STATUS_LABELS, v)),
    progress: params.getAll(PARAMS.progress).filter((v) => Object.hasOwn(PROGRESS_LABELS, v)),
  }
}

/** The same query with the filter keys replaced, other keys (such as `analysis`) kept. */
export function writeFilters(query: string, filters: Filters): string {
  const params = new URLSearchParams(query)
  for (const key of Object.values(PARAMS)) params.delete(key)
  if (filters.search) params.set(PARAMS.search, filters.search)
  for (const facet of FACETS) for (const value of filters[facet]) params.append(PARAMS[facet], value)
  return params.toString()
}
