/**
 * Service layer for the Author screens: the calls that will become gateway requests
 * (parse, check, search, export). Each resolves through src/lib/authorStore.ts after a
 * realistic delay, so the screens' loading, empty and error states are exercised now and
 * swapping a body for a request() later touches nothing else. Mutations that are local by
 * nature (typing in a file, picking a replacement) stay synchronous in useAuthorActions.
 *
 * Latency: `setMockLatency(0)` in tests. Failure: open the app with `?mock-fail=check`
 * (or parse, search, drafts, report) to see that call's error state.
 */

import { authorStore, type CheckRun } from './authorStore'
import type { Draft, ParseResult, SearchResult } from '../types/draftCheck'

export type { CheckRun } from './authorStore'

type Operation = 'drafts' | 'parse' | 'check' | 'search' | 'report'

const LATENCY_MS: Record<Operation, number> = {
  drafts: 250,
  parse: 400,
  check: 1200,
  search: 800,
  report: 1500,
}

let latencyScale = 1

/** Scales every mock delay; 0 makes calls resolve on the next tick. */
export function setMockLatency(scale: number): void {
  latencyScale = scale
}

function failing(op: Operation): boolean {
  if (typeof window === 'undefined') return false
  const wanted = new URLSearchParams(window.location.search).get('mock-fail')
  return wanted !== null && wanted.split(',').includes(op)
}

async function simulate<T>(op: Operation, read: () => T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS[op] * latencyScale))
  if (failing(op)) throw new Error(`The ${op} service did not answer. Try again in a moment.`)
  return read()
}

export class ReportUnavailable extends Error {
  constructor() {
    super('The verification report (PDF) is not available yet — the gateway has no report endpoint.')
  }
}

export const authorApi = {
  // TODO gateway: GET /author/drafts
  getDrafts: (): Promise<Draft[]> => simulate('drafts', () => authorStore.drafts()),

  // TODO gateway: GET /author/drafts/{id}
  // Resolves null, not undefined, for a draft that does not exist: TanStack Query treats an
  // undefined result as an error, and "gone" is an empty state, not a failure.
  getDraft: (draftId: string): Promise<Draft | null> => simulate('drafts', () => authorStore.draft(draftId) ?? null),

  // TODO gateway: POST /author/drafts/{id}/parse
  parseDraft: (draftId: string): Promise<ParseResult> => simulate('parse', () => authorStore.parse(draftId)),

  // TODO gateway: GET /author/drafts/{id}/check
  getCheck: (draftId: string): Promise<CheckRun | null> => simulate('check', () => authorStore.checkRun(draftId) ?? null),

  // TODO gateway: POST /author/drafts/{id}/check — async with progress events (see #204)
  recheck: (draftId: string): Promise<CheckRun> => simulate('check', () => authorStore.recheck(draftId)),

  // TODO gateway: GET /author/search?q=…  (Semantic Scholar · Crossref · arXiv)
  search: (query: string): Promise<SearchResult[]> => simulate('search', () => authorStore.search(query)),

  /** The verification report PDF. There is no endpoint yet, so this always rejects with
   * ReportUnavailable after the usual delay; the Export menu shows that as its error state. */
  // TODO gateway: POST /author/drafts/{id}/report → application/pdf
  exportReport: (draftId: string): Promise<Blob> =>
    simulate('report', () => {
      void draftId
      throw new ReportUnavailable()
    }),
}

/** "checked 2 min ago" · "checked yesterday" · "not checked yet". */
export function checkedLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'not checked yet'
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'checked just now'
  if (minutes < 60) return `checked ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `checked ${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'checked yesterday'
  return `checked ${days} days ago`
}
