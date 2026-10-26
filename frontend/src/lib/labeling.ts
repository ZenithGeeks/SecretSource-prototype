/**
 * The labeling page's data: the gateway calls, and the pure rules that turn what a person
 * decided into the rows saved to the team's labeling table (and tell them what is still undecided).
 *
 * Nothing here decides for the person. The AI's claims and passages are what the page shows
 * first; every claim and every passage is judged by hand, and the person saves.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, API_BASE, fetchFile, postEvents, request, type Source } from './api'
import type { AnswerEvent } from './assistant'

export type Level = 1 | 2 | 3 | 4
export type Confidence = 'low' | 'medium' | 'high'
export type ClaimStatus = 'accepted' | 'edited' | 'rejected'
export type CandidateStatus = 'relevant' | 'rejected'

/** What each level of the 1-4 label means. The team's rubric: edit the words here. */
export const LEVELS: { level: Level; name: string; hint: string }[] = [
  { level: 1, name: 'No support', hint: 'The passage does not back the claim, or says something else.' },
  { level: 2, name: 'Weak', hint: 'Related, but indirect, vague or only partly backs the claim.' },
  { level: 3, name: 'Clear', hint: 'The passage backs the claim, with a gap in scope or detail.' },
  { level: 4, name: 'Strong', hint: 'The passage states the claim directly and fully.' },
]

export type Candidate = {
  cand_id: string
  reference_id: string
  reference_file: string
  rank: number
  score: number | null
  page: number | null
  passage: string
}

export type SessionClaim = {
  claim_id: string
  claim: string
  sentence: string
  section: string
  source: Source | null
  candidates: Candidate[]
}

/** A cited paper. `label` is its title, or the arXiv id or DOI when the citation list had none;
 * `ref` is the "b47" the claim's sentence shows in brackets, empty when unknown. `ref`, `authors`
 * and `year` are missing from a gateway older than the frontend, for the minutes between the two
 * deploys. */
export type Reference = { reference_id: string; file: string; label: string; ref?: string; authors?: string[]; year?: string }

/** "Nogueira, Cho · 2019", "Karpukhin et al. · 2020": who wrote a reference, by surname. */
export function byline(reference: Reference): string {
  const surnames = (reference.authors ?? []).map((name) => name.trim().split(/\s+/).at(-1) ?? '').filter(Boolean)
  const who = surnames.length > 2 ? `${surnames[0]} et al.` : surnames.join(', ')
  return [who, reference.year].filter(Boolean).join(' · ')
}

/** A row as the labeling table stores it: every value a string. */
export type Row = Record<string, string>

export type Session = {
  analysis_id: string
  paper_id: string
  paper_file: string
  title: string
  annotator: string
  claims: SessionClaim[]
  references: Reference[]
  saved: { claims: Row[]; candidates: Row[]; labels: Row[] }
  /** "claim_id|reference_id" -> the other people who labeled that pair. */
  others: Record<string, string[]>
}

export type LabelStatus = { annotator: string; configured: boolean; scopus: boolean }

export type Save = {
  claims: {
    claim_id: string
    origin: 'extracted' | 'human_added'
    status: ClaimStatus
    claim: string
    claim_edited: string
    sentence: string
    page: number | null
    section: string
  }[]
  candidates: {
    claim_id: string
    reference_id: string
    cand_id: string
    /** retrieved_added: found by the live search for a claim added by hand. */
    origin: 'retrieved' | 'retrieved_added' | 'human_added'
    status: CandidateStatus
    rank?: number
    score?: number | null
    page: number | null
    passage: string
  }[]
  labels: {
    claim_id: string
    reference_id: string
    evidence: Level
    rationale: string
    spans: string[]
    confidence: Confidence
  }[]
}

/** What each topic stands for, and where its papers are published: the team's domains. */
export const TOPIC_INFO: Record<string, { name: string; venues: string; journal: string }> = {
  CV: { name: 'Computer Vision', venues: 'CVPR · ICCV · ECCV', journal: 'IEEE TPAMI' },
  NLP: { name: 'Natural Language Processing', venues: 'ACL · EMNLP · NAACL', journal: 'TACL' },
  SE: { name: 'Software Engineering', venues: 'ICSE · FSE · ASE', journal: 'IEEE TSE' },
  HPC: { name: 'High-Performance Computing', venues: 'SC · IPDPS · HPDC', journal: 'IEEE TPDS' },
}

/**
 * What to tell a person when a labeling call fails. The gateway's own text ("403: {"detail": ...}",
 * setting names) is for logs, not for them: they get a sentence and what to do next.
 */
export function problem(error: unknown): { title: string; hint: string } {
  const message = error instanceof Error ? error.message : ''
  const status = Number(/^(\d{3}):/.exec(message)?.[1])
  if (status === 401) return { title: 'Please sign in again', hint: 'Your session has ended.' }
  if (status === 403) return { title: 'You can\'t use the labeler', hint: 'Ask the team lead to give your account access.' }
  if (status === 404)
    return { title: 'This paper is not available', hint: 'It may have been deleted, or its owner has stopped sharing it.' }
  if (status === 502 && message.includes('API key'))
    return { title: 'Scopus refused the API key', hint: 'Ask whoever runs the gateway to check SCOPUS_API_KEY.' }
  if (status === 502) return { title: 'Scopus did not answer', hint: 'Try again in a moment.' }
  if (status === 504) return { title: 'Scopus took too long to answer', hint: 'Try again, or narrow the years.' }
  if (status === 429) return { title: 'The Scopus key has used its quota for now', hint: 'Try again in a minute.' }
  if (status === 409) return { title: 'This paper is not ready', hint: 'Its analysis has not finished. Try again in a moment.' }
  if (status === 422) return { title: 'That was not accepted', hint: 'Reload the page and try again.' }
  if (status === 503)
    return { title: 'Labels cannot be saved yet', hint: 'Ask whoever runs the gateway to finish the setup.' }
  return { title: 'Something went wrong', hint: 'Try again in a moment. If it keeps happening, tell the team.' }
}

/** A venue's rank on a Scopus result (`backend/app/labeling/scopus.py` `venue_rank`).
 *
 * A journal is `{ system: "CiteScore", value: "Q1".."Q4", year }`. A conference in the topic
 * list is `{ system: "CORE", value: "A*" | "A" | "B" | "C", year }` (ICORE2026). Any other
 * conference, or a journal Scopus has no CiteScore for, is `{ system: null, value: "unranked" }`.
 * `null` means the lookup failed, which is not the same as unranked. Missing on an older gateway. */
export type VenueRank = {
  system: string | null
  value: string
  year?: number | null
} | null

/** Values `GET /labeling/scopus/search` accepts, repeated once per `rank` parameter. */
export type VenueRankValue = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'A*' | 'A' | 'B' | 'C' | 'unranked'

export type RankFilter = 'any' | 'q1' | 'q1q2' | 'core'

/** The rank filter beside the venue scope. An empty `ranks` sends no `rank` parameter. */
export const RANK_FILTERS: { key: RankFilter; label: string; ranks: VenueRankValue[] }[] = [
  { key: 'any', label: 'Any', ranks: [] },
  { key: 'q1', label: 'Q1', ranks: ['Q1'] },
  { key: 'q1q2', label: 'Q1-Q2', ranks: ['Q1', 'Q2'] },
  { key: 'core', label: 'A*/A', ranks: ['A*', 'A'] },
]

export function ranksOf(filter: RankFilter): VenueRankValue[] {
  return RANK_FILTERS.find((option) => option.key === filter)?.ranks ?? []
}

/** Chip text for one Scopus result. `undefined` (no field) draws nothing; `null` is a failed lookup. */
export function venueRankLabel(rank: VenueRank | undefined): string | null {
  if (rank === undefined) return null
  if (rank === null) return 'Rank unavailable'
  if (rank.value === 'unranked' || rank.system == null) return 'Conference, unranked'
  if (rank.system === 'CORE') return `${rank.value} · CORE`
  if (rank.system === 'CiteScore') return rank.year ? `${rank.value} · CiteScore ${rank.year}` : `${rank.value} · CiteScore`
  return `${rank.value} · ${rank.system}`
}

/** Chip text for a pool paper. `venue_rank` is "Q1", "A*", "unranked" or "" (not stored).
 * `source` is "CiteScore 2025" or "CORE 2026"; the chip keeps the CiteScore year and names CORE. */
export function poolVenueRankLabel(rank: string | undefined, source: string | undefined): string | null {
  if (!rank) return null
  if (rank === 'unranked') return 'Conference, unranked'
  const citeScore = /^CiteScore(?:\s+(\d{4}))?$/.exec(source ?? '')
  if (citeScore) return venueRankLabel({ system: 'CiteScore', value: rank, year: citeScore[1] ? Number(citeScore[1]) : null })
  if (source?.startsWith('CORE')) return venueRankLabel({ system: 'CORE', value: rank })
  return source ? `${rank} · ${source}` : rank
}

export type ScopusPaper = {
  doi: string
  title: string
  venue: string
  year: string
  first_author: string
  cited_by: number
  /** From OpenAlex; empty when it has none. */
  abstract: string
  /** OpenAlex's main research topic for the paper; "" when it has none. */
  subject: string
  /** OpenAlex's keywords, best first, at most five. */
  keywords: string[]
  /** Whether the analysis can download its PDF; null when that could not be checked. */
  downloadable: boolean | null
  added: boolean
  /** How strong the venue is. Null when that could not be looked up. */
  rank?: VenueRank
}

export type ScopusSort = 'cited' | 'newest' | 'oldest' | 'match'

/** Where a search looks: the topic's venues, or every venue in Scopus. */
export type ScopusScope = 'topic' | 'all'

/** One Scopus search: where it looks, optional words (or a DOI or paper link), a year range, an
 * order, and the venue ranks to keep. The topic is where an added paper is filed, whatever the scope.
 * An empty `ranks` does not filter. */
export type ScopusQuery = {
  topic: string
  scope: ScopusScope
  q: string
  since: number
  until: number
  sort: ScopusSort
  ranks: VenueRankValue[]
}

export type ScopusPage = {
  total: number
  results: ScopusPaper[]
  /** How many papers on this page a rank filter left out. Missing on an older gateway. */
  hidden?: number
}

/** The line under the results. A rank filter on all of Scopus only hides papers after the page
 * comes back, so the line says how many of that page are still showing (`hidden` is the rest). */
export function scopusResultLine(
  total: number,
  pages: { results: readonly unknown[]; hidden?: number }[],
  scope: ScopusScope,
  ranks: readonly string[],
): string {
  const shown = pages.reduce((count, page) => count + page.results.length, 0)
  const count = `${total.toLocaleString()} papers · showing ${shown.toLocaleString()}`
  if (scope !== 'all' || ranks.length === 0) return count
  const hidden = pages.reduce((count, page) => count + (page.hidden ?? 0), 0)
  const where = pages.length > 1 ? 'on these pages' : 'on this page'
  return `${total.toLocaleString()} papers · showing ${shown.toLocaleString()} of ${(shown + hidden).toLocaleString()} ${where}`
}

/** A PDF for a paper the analysis could not download (see labelingApi.uploadPaper). */
export type UploadedPaper = { file: File; topic: string; doi?: string; replaces?: string }

export type Pool = {
  topics: string[]
  me: string
  people: { name: string; topic: string }[]
  /** Analyses their owners shared with the team, each under a topic. */
  papers: {
    analysis_id: string
    title: string
    topic: string
    claims: number
    /** How many of its claims the signed-in person has judged. */
    judged: number
    /** How many of its claims anyone on the team has judged; two people on one claim count once. */
    team_judged: number
    /** Everyone who has judged any of its claims, the signed-in person included. */
    labelers: string[]
    status: 'running' | 'done' | 'error'
    reason: string
    mine: boolean
    /** Who shared it with the team. Only they can retry or remove it. */
    added_by: string
    /** From OpenAlex by the paper's DOI, as in a Scopus result; empty for a paper with no DOI. */
    subject: string
    keywords: string[]
    /** "Q1", "A*", "unranked", or "" when the rank was not stored. Missing on an older gateway. */
    venue_rank?: string
    /** "CiteScore 2025", "CORE 2026", or "". */
    venue_rank_source?: string
  }[]
}

const putJson = (path: string, body: unknown) =>
  request<unknown>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const labelingApi = {
  pool: () => request<Pool>('/labeling/pool'),
  scopusSearch: ({ topic, scope, q, since, until, sort, ranks }: ScopusQuery, page: number) => {
    const params = new URLSearchParams({
      topic,
      scope,
      q,
      since: String(since),
      until: String(until),
      sort,
      page: String(page),
    })
    for (const rank of ranks) params.append('rank', rank)
    return request<ScopusPage>(`/labeling/scopus/search?${params}`)
  },
  scopusAdd: (doi: string, topic: string) =>
    request<{ id: string; existing: boolean }>('/labeling/scopus/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doi, topic }),
    }),
  setPersonTopic: (name: string, topic: string) => putJson('/labeling/people', { name, topic }),
  setPaperTopic: (analysisId: string, topic: string) =>
    putJson(`/labeling/papers/${encodeURIComponent(analysisId)}/topic`, { topic }),
  /** Read one of your failed papers again; a new analysis takes its place on the list. */
  retryPaper: (analysisId: string) =>
    request<{ id: string }>(`/labeling/papers/${encodeURIComponent(analysisId)}/retry`, { method: 'POST' }),
  /** Analyse a paper from its PDF and list it for the team. The PDF is uploaded the way the
   * Researcher role uploads one (straight to the papers bucket where the web proxy would refuse
   * a large file, #266), then the new analysis is listed. `doi` links it to its Scopus record;
   * `replaces` is one of your failed papers, which it takes the place of. */
  uploadPaper: async ({ file, topic, doi = '', replaces = '' }: UploadedPaper) => {
    const { id } = await api.uploadAnalysis(file, true)
    return request<{ id: string }>(`/labeling/papers/${encodeURIComponent(id)}/share-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, doi, replaces }),
    })
  },
  status: () => request<LabelStatus>('/labeling/status'),
  session: (analysisId: string) => request<Session>(`/labeling/sessions/${encodeURIComponent(analysisId)}`),
  save: (analysisId: string, body: Save) =>
    request<{ claims: number; candidates: number; labels: number }>(
      `/labeling/sessions/${encodeURIComponent(analysisId)}/save`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    ),
  /** Search every reference paper for a claim added by hand, as the analysis did for its own. */
  candidates: (analysisId: string, claimId: string, claim: string) =>
    request<{ candidates: Candidate[] }>(`/labeling/sessions/${encodeURIComponent(analysisId)}/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimId, claim }),
    }),
  /** The labels as CSV, or as the two sets of DSPy examples (JSONL): your own rows, or the whole team's. */
  exportFile: (tab: 'labels' | 'claims' | 'candidates' | 'dspy_claims' | 'dspy_verdicts', scope: 'mine' | 'team' = 'mine') =>
    fetchFile(`${API_BASE}/api/labeling/export?tab=${tab}&scope=${scope}`),
}

export function useLabelStatus() {
  return useQuery({ queryKey: ['labeling', 'status'], queryFn: labelingApi.status, retry: false })
}

/** How often the paper list asks again: often while a paper is being read, so its row turns
 * Ready soon after the analysis ends, and every half minute otherwise, for teammates' topics
 * and progress. One ask reads ~20 claim rows from Supabase, about 140 ms. */
export const POOL_POLL_MS = { reading: 5_000, idle: 30_000 }

export function usePool() {
  return useQuery({
    queryKey: ['labeling', 'pool'],
    queryFn: labelingApi.pool,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.papers.some((p) => p.status === 'running') ? POOL_POLL_MS.reading : POOL_POLL_MS.idle,
    // A hidden tab keeps asking, so the paper notices and the tab title still update there.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })
}

/** The pages of one Scopus search, 25 papers each; null searches nothing yet. Each page costs
 * Scopus quota, so a page is only fetched when the reader asks for it. */
export function useScopusSearch(query: ScopusQuery | null) {
  return useInfiniteQuery({
    queryKey: ['labeling', 'scopus', query],
    queryFn: ({ pageParam }) => labelingApi.scopusSearch(query as ScopusQuery, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      // `total` counts every Scopus hit. A rank filter on all venues hides some after the page
      // arrives (`hidden`), and a page can come back empty when every paper on it was hidden.
      const fetched = pages.reduce((count, page) => count + page.results.length + (page.hidden ?? 0), 0)
      if (fetched >= last.total || (last.results.length === 0 && !(last.hidden ?? 0))) return undefined
      return pages.length
    },
    enabled: query !== null,
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useScopusAdd() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { doi: string; topic: string }) => labelingApi.scopusAdd(v.doi, v.topic),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labeling', 'pool'] }),
  })
}

type Assignment = { topic: string; name?: string; analysisId?: string }

/** The pool as it will be once `v` is saved: a paper with no topic leaves the list. */
function assigned(pool: Pool, v: Assignment): Pool {
  if (v.name !== undefined)
    return { ...pool, people: pool.people.map((p) => (p.name === v.name ? { ...p, topic: v.topic } : p)) }
  const papers = v.topic
    ? pool.papers.map((p) => (p.analysis_id === v.analysisId ? { ...p, topic: v.topic } : p))
    : pool.papers.filter((p) => p.analysis_id !== v.analysisId)
  return { ...pool, papers }
}

/** Sets a person's topic (`name`) or shares one of your own analyses (`analysisId`); "" undoes it.
 * The list shows the change at once and goes back if the save fails. */
export function useAssignTopic() {
  const queryClient = useQueryClient()
  const queryKey = ['labeling', 'pool']
  return useMutation({
    mutationFn: (v: Assignment) =>
      v.name !== undefined ? labelingApi.setPersonTopic(v.name, v.topic) : labelingApi.setPaperTopic(v.analysisId!, v.topic),
    onMutate: async (v) => {
      // A poll that lands after this would bring back the old topic for a moment.
      await queryClient.cancelQueries({ queryKey })
      const before = queryClient.getQueryData<Pool>(queryKey)
      if (before) queryClient.setQueryData(queryKey, assigned(before, v))
      return { before }
    },
    onError: (_error, _v, context) => {
      if (context?.before) queryClient.setQueryData(queryKey, context.before)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}

export function useRetryPaper() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (analysisId: string) => labelingApi.retryPaper(analysisId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labeling', 'pool'] }),
  })
}

/** `onUploaded` runs for every upload that went through. A callback given to `mutate` runs only
 * for the latest call, so a list that can start several uploads passes this instead. */
export function useUploadPaper(onUploaded?: (upload: UploadedPaper) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: labelingApi.uploadPaper,
    onSuccess: (_reply, upload) => {
      onUploaded?.(upload)
      return queryClient.invalidateQueries({ queryKey: ['labeling', 'pool'] })
    },
  })
}

export function useLabelSession(analysisId: string | null) {
  return useQuery({
    queryKey: ['labeling', 'session', analysisId],
    queryFn: () => labelingApi.session(analysisId!),
    enabled: Boolean(analysisId),
    retry: false,
    // The workspace copies this into drafts once, so a cached copy from before the last save
    // must never seed it, and a refetch must not replace what is being typed.
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

export function useSaveLabels(analysisId: string) {
  return useMutation({ mutationFn: (body: Save) => labelingApi.save(analysisId, body) })
}

// --- the AI's review of a saved claim (backend/app/labeling/review.py) ---

/** What a finding points at; matches a `data-ask-target="kind:id"` on the page. */
export type ReviewTarget = { kind: 'claim' | 'passage' | 'reference'; id: string }

export type Finding = {
  target: ReviewTarget
  tone: 'agrees' | 'flags' | 'asks'
  text: string
}

export type ReviewEvent = ({ type: 'finding' } & Finding) | { type: 'done'; findings: number } | { type: 'error'; message: string }

export const reviewClaim = (analysisId: string, claimId: string, onEvent: (event: ReviewEvent) => void, signal: AbortSignal) =>
  postEvents(`/labeling/sessions/${encodeURIComponent(analysisId)}/review`, { claim_id: claimId }, onEvent, signal)

/** Asks about the paper under review, or about one of its references with `referenceId`. */
export const askLabeling = (
  analysisId: string,
  question: string,
  referenceId: string,
  onEvent: (event: AnswerEvent) => void,
  signal: AbortSignal,
) => postEvents(`/labeling/sessions/${encodeURIComponent(analysisId)}/ask`, { question, reference_id: referenceId }, onEvent, signal)

// --- what a person decided about one claim ---

export type AddedPassage = { reference_id: string; page: number | null; passage: string }

export type LabelDraft = { evidence: Level | null; rationale: string; confidence: Confidence }

export type Draft = {
  status: ClaimStatus | null // null: not judged yet
  edited: string
  cands: Record<string, CandidateStatus> // by cand_id; absent: not judged yet
  added: AddedPassage[] // passages the person found that retrieval missed
  labels: Record<string, LabelDraft> // by reference_id
}

/** A claim of the paper as extracted, or one the person added because extraction missed it.
 * `page` is where a hand-added claim was selected in the paper; an extracted claim keeps its
 * page in `source`. */
export type WorkClaim = SessionClaim & { origin: 'extracted' | 'human_added'; page?: number | null }

export const emptyDraft = (): Draft => ({ status: null, edited: '', cands: {}, added: [], labels: {} })
export const emptyLabel = (): LabelDraft => ({ evidence: null, rationale: '', confidence: 'medium' })

const numberOrNull = (value: string | undefined) => (value && !Number.isNaN(Number(value)) ? Number(value) : null)

/** The claims to work through: the extracted ones, then the ones this person added earlier.
 * An added claim keeps the passages the live search found for it that were judged and saved. */
export function workClaims(session: Session): WorkClaim[] {
  const extracted = session.claims.map((c) => ({ ...c, origin: 'extracted' as const }))
  const known = new Set(session.claims.map((c) => c.claim_id))
  const fileOf = (id: string) => session.references.find((r) => r.reference_id === id)?.file ?? ''
  const searched = (claimId: string): Candidate[] =>
    session.saved.candidates
      .filter((row) => row.claim_id === claimId && row.origin === 'retrieved_added')
      .map((row) => ({
        cand_id: row.cand_id,
        reference_id: row.reference_id,
        reference_file: fileOf(row.reference_id),
        rank: Number(row.rank) || 0,
        score: numberOrNull(row.score),
        page: numberOrNull(row.page),
        passage: row.passage,
      }))
  const added = session.saved.claims
    .filter((row) => row.origin === 'human_added' && !known.has(row.claim_id))
    .map((row) => ({
      claim_id: row.claim_id,
      claim: row.claim,
      sentence: row.sentence ?? '',
      section: row.section ?? '',
      source: null,
      candidates: searched(row.claim_id),
      origin: 'human_added' as const,
      page: numberOrNull(row.page),
    }))
  return [...extracted, ...added]
}

/** What this person already saved for a claim, as a draft to carry on from. */
export function draftFromSaved(claim: WorkClaim, saved: Session['saved']): Draft {
  const draft = emptyDraft()
  const row = saved.claims.find((r) => r.claim_id === claim.claim_id)
  if (row) {
    draft.status = row.status as ClaimStatus
    draft.edited = row.claim_edited ?? ''
  }
  for (const r of saved.candidates.filter((r) => r.claim_id === claim.claim_id)) {
    if (r.origin === 'retrieved' || r.origin === 'retrieved_added') draft.cands[r.cand_id] = r.status as CandidateStatus
    else if (r.status === 'relevant')
      draft.added.push({ reference_id: r.reference_id, page: numberOrNull(r.page), passage: r.passage })
  }
  for (const r of saved.labels.filter((r) => r.claim_id === claim.claim_id)) {
    draft.labels[r.reference_id] = {
      evidence: Number(r.evidence) as Level,
      rationale: r.rationale,
      confidence: (r.confidence || 'medium') as Confidence,
    }
  }
  return draft
}

/** The references this claim is read against: where retrieval looked, plus ones the person added. */
export function referencesOf(claim: WorkClaim, draft: Draft): string[] {
  return [...new Set([...claim.candidates.map((c) => c.reference_id), ...draft.added.map((a) => a.reference_id)])]
}

/** The passages a person called relevant for one reference: the quotes behind its label. */
export function relevantPassages(claim: WorkClaim, draft: Draft, referenceId: string): string[] {
  return [
    ...claim.candidates
      .filter((c) => c.reference_id === referenceId && draft.cands[c.cand_id] === 'relevant')
      .map((c) => c.passage),
    ...draft.added.filter((a) => a.reference_id === referenceId).map((a) => a.passage),
  ]
}

/**
 * The retrieved passages in the order the page shows them: grouped by reference paper (in the
 * order retrieval first met each one), and by rank within a paper.
 */
export function displayOrder(claim: WorkClaim): Candidate[] {
  const papers = [...new Set(claim.candidates.map((c) => c.reference_id))]
  return papers.flatMap((id) => claim.candidates.filter((c) => c.reference_id === id).sort((a, b) => a.rank - b.rank))
}

/** The passage to open first for a claim: the top-scoring one, taken from a reference its sentence
 * cites ("[b47]" or "[b4, b9]") when the search found that reference. The scores are raw ColBERT
 * scores for one query, so they can be compared across references. */
export function bestCandidate(claim: WorkClaim, references: Reference[]): Candidate | undefined {
  const markers = new Set(
    [...claim.sentence.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(/[,;]/).map((part) => part.trim())),
  )
  const cited = new Set(references.filter((r) => r.ref && markers.has(r.ref)).map((r) => r.reference_id))
  const byScore = [...claim.candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return byScore.find((c) => cited.has(c.reference_id)) ?? byScore[0]
}

/** True when a draft is what was last saved (nothing saved yet reads as an empty draft). */
export const sameDraft = (draft: Draft, saved: Draft | undefined) =>
  JSON.stringify(draft) === JSON.stringify(saved ?? emptyDraft())

/** What is still undecided, in words. Empty means the claim is finished. */
export function remaining(claim: WorkClaim, draft: Draft, references: Reference[]): string[] {
  if (!draft.status) return ['Decide on the claim: keep, edit or reject it']
  if (draft.status === 'rejected') return []
  const left: string[] = []
  if (draft.status === 'edited' && (!draft.edited.trim() || draft.edited.trim() === claim.claim.trim()))
    left.push('Write the edited claim')
  const unjudged = claim.candidates.filter((c) => !draft.cands[c.cand_id]).length
  if (unjudged) left.push(`${unjudged} passage${unjudged === 1 ? '' : 's'} not judged`)
  for (const id of referencesOf(claim, draft)) {
    if (relevantPassages(claim, draft, id).length && !draft.labels[id]?.evidence) {
      left.push(`Give ${references.find((r) => r.reference_id === id)?.label ?? id} a level`)
    }
  }
  return left
}

export const isDone = (claim: WorkClaim, draft: Draft, references: Reference[]) =>
  remaining(claim, draft, references).length === 0

const sameAdded = (a: AddedPassage, b: AddedPassage) => a.reference_id === b.reference_id && a.passage === b.passage

/**
 * The rows to save for one claim. A rejected claim saves only that: nobody judges its passages.
 * `saved` is the draft as last saved, so a passage added then removed is retracted in the table
 * (rows are never deleted there, a later row replaces the earlier one).
 */
export function buildSave(claim: WorkClaim, draft: Draft, saved?: Draft): Save {
  const save: Save = { claims: [], candidates: [], labels: [] }
  if (!draft.status) return save
  save.claims.push({
    claim_id: claim.claim_id,
    origin: claim.origin,
    status: draft.status,
    claim: claim.claim,
    claim_edited: draft.status === 'edited' ? draft.edited.trim() : '',
    sentence: claim.sentence,
    page: claim.source?.page ?? claim.page ?? null,
    section: claim.section,
  })
  if (draft.status === 'rejected') return save

  for (const c of claim.candidates) {
    const status = draft.cands[c.cand_id]
    if (!status) continue
    if (claim.origin === 'extracted') {
      // The server copies rank, page and text from the analysis, so the id is enough.
      save.candidates.push({
        claim_id: claim.claim_id,
        reference_id: c.reference_id,
        cand_id: c.cand_id,
        origin: 'retrieved',
        status,
        page: null,
        passage: '',
      })
    } else {
      // Found by the live search, which the server has no record of: send what was shown.
      save.candidates.push({
        claim_id: claim.claim_id,
        reference_id: c.reference_id,
        cand_id: c.cand_id,
        origin: 'retrieved_added',
        status,
        rank: c.rank,
        score: c.score,
        page: c.page,
        passage: c.passage,
      })
    }
  }
  for (const a of draft.added) {
    save.candidates.push({
      claim_id: claim.claim_id,
      reference_id: a.reference_id,
      cand_id: '',
      origin: 'human_added',
      status: 'relevant',
      page: a.page,
      passage: a.passage,
    })
  }
  for (const gone of saved?.added.filter((a) => !draft.added.some((a2) => sameAdded(a, a2))) ?? []) {
    save.candidates.push({
      claim_id: claim.claim_id,
      reference_id: gone.reference_id,
      cand_id: '',
      origin: 'human_added',
      status: 'rejected',
      page: gone.page,
      passage: gone.passage,
    })
  }
  for (const id of referencesOf(claim, draft)) {
    const label = draft.labels[id]
    if (!label?.evidence) continue
    save.labels.push({
      claim_id: claim.claim_id,
      reference_id: id,
      evidence: label.evidence,
      rationale: label.rationale.trim(),
      spans: relevantPassages(claim, draft, id).slice(0, 10),
      confidence: label.confidence,
    })
  }
  return save
}

/** Claims finished and saved, for the progress bar: an unsaved draft is not finished yet. */
export function progress(
  claims: WorkClaim[],
  drafts: Record<string, Draft>,
  references: Reference[],
  saved: Record<string, Draft>,
) {
  const done = claims.filter((c) => {
    const draft = drafts[c.claim_id] ?? emptyDraft()
    return isDone(c, draft, references) && sameDraft(draft, saved[c.claim_id])
  }).length
  return { done, total: claims.length }
}
