/**
 * The labeling page's data: the gateway calls, and the pure rules that turn what a person
 * decided into the rows saved to the team's labeling table (and tell them what is still undecided).
 *
 * Nothing here decides for the person. The AI's claims and passages are what the page shows
 * first; every claim and every passage is judged by hand, and the person saves.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, API_BASE, fetchFile, postEvents, reasonText, request, type CitationMarker, type Source, type SourceOutcome } from './api'
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

/** A citation the analysis did not check, with why: "named" (the paper only names the work) or
 * one of api.ts's Reason codes. `url`, `doi` and `year` are the reference list's own, '' when it
 * had none; they are missing from a gateway older than these fields. */
export type UncheckedCitation = {
  ref: string
  label: string
  reason: string
  url?: string
  doi?: string
  year?: string
  source_outcome?: SourceOutcome
}

export type SessionClaim = {
  claim_id: string
  claim: string
  sentence: string
  section: string
  source: Source | null
  candidates: Candidate[]
  /** The citations that were not checked. Missing from a gateway older than this field. */
  unchecked?: UncheckedCitation[]
  /** The "b23"s the claim cites, in its order. Missing from a gateway older than this field,
   * and from a claim added by hand. */
  cited?: string[]
}

/** A cited paper. `label` is its title, or the arXiv id or DOI when the citation list had none;
 * `ref` is the "b47" the claim's sentence shows in brackets, empty when unknown. `ref`, `authors`
 * and `year` are missing from a gateway older than the frontend, for the minutes between the two
 * deploys. */
export type Reference = { reference_id: string; file: string; label: string; ref?: string; authors?: string[]; year?: string }

/** "Nogueira, Cho · 2019", "Karpukhin et al. · 2020": who wrote a reference, by surname. */
export function byline(reference: Reference): string {
  const surnames = (reference.authors ?? []).map((name) => name.trim().replace(/^.*\s/, '')).filter(Boolean)
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
  /** Cited works with no PDF (file ""): a passage can be added and a level given, nothing opens (#824).
   * Missing from a gateway older than this field. */
  unread?: Reference[]
  /** Where the paper cites its references; missing from a gateway older than this field. */
  markers?: CitationMarker[]
  saved: { claims: Row[]; candidates: Row[]; labels: Row[] }
  /** "claim_id|reference_id" -> the other people who labeled that pair. Empty on a blind check. */
  others: Record<string, string[]>
  /** The signed-in person checks this paper blind: other labels, Review and Ask are hidden (#867).
   * Missing from a gateway older than this field. */
  blind?: boolean
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
    /** "" when the labeler saved a level without choosing. Omitted on an old client, which the
     * gateway still stores as medium. */
    confidence: Confidence | ''
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
 * A 403 that never reached the gateway. Cloudflare answers with an HTML challenge page
 * ("Just a moment..."); the gateway's own 403 is JSON with "detail". An empty or plain-text
 * 403 stays an access denial, because that is all the labeler can tell.
 */
export function cloudflareBlocked(message: string): boolean {
  const body = message.replace(/^\d{3}:\s*/, '').trim()
  if (!body) return false
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const parsed = JSON.parse(body) as unknown
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) return false
    } catch {
      // not JSON; an HTML page can still be a challenge
    }
  }
  const lower = body.toLowerCase()
  return (
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html') ||
    lower.includes('<html') ||
    lower.includes('just a moment') ||
    lower.includes('cf-mitigated') ||
    lower.includes('challenge-platform') ||
    lower.includes('/cdn-cgi/') ||
    lower.includes('attention required')
  )
}

const BLOCKED_BY_PROTECTION = {
  title: "The site's protection blocked this request",
  hint: 'It never reached the labeler. Reload the page, or open /api/health and pass the check, then try again.',
}

/**
 * What to tell a person when a labeling call fails. The gateway's own text ("403: {"detail": ...}",
 * setting names) is for logs, not for them: they get a sentence and what to do next.
 */
export function problem(error: unknown): { title: string; hint: string } {
  const message = error instanceof Error ? error.message : ''
  const status = Number(/^(\d{3}):/.exec(message)?.[1])
  if (status === 401) return { title: 'Please sign in again', hint: 'Your session has ended.' }
  if (status === 403) {
    if (cloudflareBlocked(message)) return BLOCKED_BY_PROTECTION
    return { title: 'You can\'t use the labeler', hint: 'Ask the team lead to give your account access.' }
  }
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
  /** How strong its venue is; null when that could not be looked up. */
  rank: VenueRank | null
}

/** A journal's CiteScore quartile, a conference's CORE rank, or "unranked" for a conference the
 * team has no rank for or a journal with no CiteScore (SCRUM-445). */
export type VenueRank = { system: 'CiteScore' | 'CORE' | null; value: string; year: number | null }

/** The ranks a search can be limited to: [] for any venue. */
export const RANK_FILTERS = {
  any: [],
  top: ['Q1', 'A*'],
  upper: ['Q1', 'Q2', 'A*', 'A'],
} as const satisfies Record<string, readonly string[]>
export type RankFilter = keyof typeof RANK_FILTERS

export type ScopusSort = 'cited' | 'newest' | 'oldest' | 'match'

/** Where a search looks: the topic's venues, or every venue in Scopus. */
export type ScopusScope = 'topic' | 'all'

/** One Scopus search: where it looks, optional words (or a DOI or paper link), a year range, and
 * an order. The topic is where an added paper is filed, whatever the scope. */
export type ScopusQuery = {
  topic: string
  scope: ScopusScope
  q: string
  since: number
  until: number
  sort: ScopusSort
  rank: RankFilter
}

/** `hidden`: papers on this page the rank filter left out. Scopus counts them in `total`. */
export type ScopusPage = { total: number; results: ScopusPaper[]; hidden: number }

/** A PDF for a paper the analysis could not download (see labelingApi.uploadPaper). */
export type UploadedPaper = { file: File; topic: string; doi?: string; replaces?: string }

/** A lead's record of who checks which paper blind. */
export type BlindCheck = { name: string; analysis_id: string }

export type Pool = {
  topics: string[]
  me: string
  /** Leads can download the whole team's labels and assign blind checks. Missing from an older gateway. */
  lead?: boolean
  /** The analyses the signed-in person checks blind. They are listed under Blind checks, not here. */
  blind?: string[]
  /** Every blind check on the team; only a lead gets these. */
  blind_checks?: BlindCheck[]
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
    /** Its venue's rank when it was listed ("Q1", "A*", "unranked"), and where the rank comes from
     * ("CiteScore 2025"); both "" when it is not known. */
    venue_rank: string
    venue_rank_source: string
  }[]
}

const putJson = (path: string, body: unknown) =>
  request<unknown>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const labelingApi = {
  pool: () => request<Pool>('/labeling/pool'),
  scopusSearch: ({ topic, scope, q, since, until, sort, rank }: ScopusQuery, page: number) => {
    const params = new URLSearchParams({ topic, scope, q, since: String(since), until: String(until), sort, page: String(page) })
    for (const value of RANK_FILTERS[rank]) params.append('rank', value)
    return request<ScopusPage>(`/labeling/scopus/search?${params}`)
  },
  scopusAdd: (doi: string, topic: string) =>
    request<{ id: string; existing: boolean }>('/labeling/scopus/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doi, topic }),
    }),
  setPersonTopic: (name: string, topic: string) => putJson('/labeling/people', { name, topic }),
  /** A lead gives `name` a paper to label blind (`on`), or takes it back. */
  setBlindCheck: (name: string, analysisId: string, on: boolean) =>
    putJson('/labeling/blind', { name, analysis_id: analysisId, on }),
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
    // A page the rank filter emptied still moves through Scopus's results, so hidden ones count.
    getNextPageParam: (last, pages) =>
      pages.reduce((seen, page) => seen + page.results.length + (page.hidden ?? 0), 0) < last.total &&
      last.results.length + (last.hidden ?? 0)
        ? pages.length
        : undefined,
    enabled: query !== null,
    retry: false,
    staleTime: 5 * 60_000,
  })
}

/** Assigns or takes back a blind check, then reads the pool again. */
export function useBlindCheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: BlindCheck & { on: boolean }) => labelingApi.setBlindCheck(v.name, v.analysis_id, v.on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labeling', 'pool'] }),
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

/** What a labeler's question is about: the paper under review (reference_id ""), one of its
 * references, or one passage of a reference read with the claim as worded on screen. */
export type AskAbout = { reference_id: string; passage?: string; claim?: string }

/** Asks about the paper under review, one of its references, or one passage of a reference. */
export const askLabeling = (
  analysisId: string,
  question: string,
  about: AskAbout,
  onEvent: (event: AnswerEvent) => void,
  signal: AbortSignal,
) => postEvents(`/labeling/sessions/${encodeURIComponent(analysisId)}/ask`, { question, ...about }, onEvent, signal)

// --- what a person decided about one claim ---

export type AddedPassage = { reference_id: string; page: number | null; passage: string }

export type LabelDraft = { evidence: Level | null; rationale: string; confidence: Confidence | null }

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
/** Confidence starts unset. Medium is a real answer, so a skipped one must not look like one. */
export const emptyLabel = (): LabelDraft => ({ evidence: null, rationale: '', confidence: null })

/** '' is a saved level whose confidence was never chosen. A missing value is an older row: the
 * gateway used to store Medium when the field was left out, so those rows still load as Medium. */
export function readConfidence(value: string | undefined): Confidence | null {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  if (value === '') return null
  return 'medium'
}

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
      confidence: readConfidence(r.confidence),
    }
  }
  return draft
}

/** A reference can fold once every passage is judged and, if any of them were relevant, it has a level. */
export function referenceFinished(claim: WorkClaim, draft: Draft, referenceId: string): boolean {
  const cands = claim.candidates.filter((c) => c.reference_id === referenceId)
  if (cands.some((c) => !draft.cands[c.cand_id])) return false
  if (relevantPassages(claim, draft, referenceId).length > 0) return Boolean(draft.labels[referenceId]?.evidence)
  return cands.length > 0 || draft.added.some((a) => a.reference_id === referenceId)
}

/** "[b40] 3/4 relevant · Clear · Medium" for a folded reference. */
export function referenceSummary(
  claim: WorkClaim,
  draft: Draft,
  reference: Reference | undefined,
  referenceId: string,
): string {
  const tag = reference?.ref ? `[${reference.ref}]` : (reference?.label ?? referenceId)
  const total =
    claim.candidates.filter((c) => c.reference_id === referenceId).length +
    draft.added.filter((a) => a.reference_id === referenceId).length
  const level = draft.labels[referenceId]?.evidence
  const confidence = draft.labels[referenceId]?.confidence
  const count = `${relevantPassages(claim, draft, referenceId).length}/${total} relevant`
  const parts = [`${tag} ${count}`]
  if (level) parts.push(LEVELS[level - 1].name)
  if (confidence) parts.push(confidence[0].toUpperCase() + confidence.slice(1))
  return parts.join(' · ')
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

/** What a sentence cites in brackets: "[b47]" and "[b4, b9]" give b47, b4 and b9. */
const sentenceMarkers = (sentence: string): string[] =>
  [...sentence.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(/[,;]/).map((part) => part.trim()))

/** The "b23"s a claim cites, in its order: the gateway's list, or the markers in its sentence
 * when the gateway is older than that list or the claim was added by hand. */
export const citedRefs = (claim: SessionClaim): string[] => claim.cited ?? sentenceMarkers(claim.sentence)

/** The references a claim cites that have a PDF, in the order it cites them. A claim with no
 * passages opens the first of these, never a reference only another claim cites. */
export function citedReferences(claim: SessionClaim, references: Reference[]): Reference[] {
  return citedRefs(claim).flatMap((ref) => references.find((r) => r.ref === ref) ?? [])
}

/** A cited work with no PDF to open, as the reference pane lists it. */
export type Unresolved = {
  ref: string
  label: string
  year: string
  reason: string
  links: { text: string; href: string }[]
  sourceOutcome?: SourceOutcome
}

/** Why a citation was not read, in plain words: api.ts's wording, plus the labeler's own "named". */
const OUTCOME_TEXT: Record<string, string> = {
  'named-only': 'the paper only names it, so it was not checked',
  'not-attempted': 'this reference was not checked in the analysis',
  'no-match': 'no matching work was found in the indexes checked',
  'ambiguous-match': 'more than one matching work was found',
  'identity-mismatch': 'the matching title belonged to a different work',
  'no-accessible-copy': 'the work was identified, but no free copy was found',
  blocked: 'the source location blocked the download',
  'not-found': 'the source location returned not found',
  'download-failed': 'the source location did not provide a readable PDF',
  'invalid-content': 'the source returned content that was not a readable PDF',
  'temporary-failure': 'a lookup or download failed temporarily',
  'lookup-failed': 'the lookup service did not answer',
  'web-page': 'a fetched web page was found instead of a paper PDF',
  'retrieval-failed': 'the retrieval service could not finish checking this paper',
  withdrawn: 'the paper was withdrawn by its authors on arXiv',
  'indexing-failed': 'the paper was downloaded but could not be indexed for retrieval',
}

export const uncheckedReason = (reason: string, sourceOutcome?: SourceOutcome): string =>
  OUTCOME_TEXT[sourceOutcome?.outcome ?? ''] ??
  (reason === 'named' ? 'the paper only names it, so it was not checked' : reasonText(reason))

// Only http(s): the link comes from a PDF's reference list, so any other scheme is not followed.
const webLink = (url: string | undefined) => (url && /^https?:\/\//i.test(url) ? [{ text: url, href: url }] : [])
const doiLink = (doi: string | undefined) =>
  doi ? [{ text: `doi:${doi}`, href: `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` }] : []

/**
 * The works a claim cites that have no PDF here: the citations the analysis did not check, then
 * any other cited work that was never read (nothing to look it up by). One that does have a PDF,
 * read for another claim, is left out: it opens instead. Empty when the claim cites nothing, or
 * everything it cites can be opened.
 */
export function unresolvedCitations(claim: SessionClaim, session: Pick<Session, 'references' | 'unread'>): Unresolved[] {
  const readable = new Set(session.references.flatMap((r) => r.ref ?? []))
  const unchecked = (claim.unchecked ?? []).filter((row) => !readable.has(row.ref))
  const listed = new Set(unchecked.map((row) => row.ref))
  const cited = new Set(claim.cited ?? [])
  const unread = (session.unread ?? []).filter((r) => r.ref && cited.has(r.ref) && !listed.has(r.ref))
  return [
    ...unchecked.map((row) => ({
      ref: row.ref,
      label: row.label,
      year: row.year ?? '',
      reason: row.reason === 'unresolvable' && !row.source_outcome
        ? row.url
          ? 'a web page, not a paper we can check a claim against'
          : !row.doi ? 'no DOI or arXiv ID to look it up by' : uncheckedReason(row.reason)
        : uncheckedReason(row.reason, row.source_outcome),
      links: [...doiLink(row.doi), ...webLink(row.url)],
      ...(row.source_outcome ? { sourceOutcome: row.source_outcome } : {}),
    })),
    ...unread.map((r) => ({
      ref: r.ref!, label: r.label, year: r.year ?? '',
      reason: uncheckedReason('unresolvable', {
        source_kind: 'unknown', outcome: 'not-attempted', retryable: false, attempts: [],
      }),
      links: [],
      sourceOutcome: { source_kind: 'unknown' as const, outcome: 'not-attempted', retryable: false, attempts: [] },
    })),
  ]
}

/** The passage to open first for a claim: the top-scoring one, taken from a reference its sentence
 * cites ("[b47]" or "[b4, b9]") when the search found that reference. The scores are raw ColBERT
 * scores for one query, so they can be compared across references. */
export function bestCandidate(claim: WorkClaim, references: Reference[]): Candidate | undefined {
  const markers = new Set(sentenceMarkers(claim.sentence))
  const cited = new Set(references.filter((r) => r.ref && markers.has(r.ref)).map((r) => r.reference_id))
  const byScore = [...claim.candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return byScore.find((c) => cited.has(c.reference_id)) ?? byScore[0]
}

/** True when a draft is what was last saved (nothing saved yet reads as an empty draft). */
export const sameDraft = (draft: Draft, saved: Draft | undefined) =>
  JSON.stringify(draft) === JSON.stringify(saved ?? emptyDraft())

/** Decisions not saved yet, kept in this browser so a reload or a gateway outage loses none:
 * the draft of each unsaved claim, and the unsaved claims added by hand. */
export type Unsaved = { drafts: Record<string, Draft>; added: WorkClaim[] }

const unsavedKey = (analysisId: string, annotator: string) => `labeler.unsaved.${analysisId}.${annotator}`

export function readUnsaved(analysisId: string, annotator: string): Unsaved | null {
  try {
    const stored = window.localStorage.getItem(unsavedKey(analysisId, annotator))
    return stored ? (JSON.parse(stored) as Unsaved) : null
  } catch {
    return null // storage blocked, or a value this version cannot read
  }
}

/** Keep `unsaved`, or forget it once nothing is left unsaved. */
export function writeUnsaved(analysisId: string, annotator: string, unsaved: Unsaved): void {
  try {
    const key = unsavedKey(analysisId, annotator)
    if (Object.keys(unsaved.drafts).length) window.localStorage.setItem(key, JSON.stringify(unsaved))
    else window.localStorage.removeItem(key)
  } catch {
    // storage blocked or full: the drafts are still on screen until saved
  }
}

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
    const ref = references.find((r) => r.reference_id === id)
    const title = ref?.label ?? id
    if (relevantPassages(claim, draft, id).length && !draft.labels[id]?.evidence) left.push(`Give ${title} a level`)
    else if (draft.labels[id]?.evidence && !draft.labels[id]?.confidence) {
      left.push(`Give ${ref?.ref ? `[${ref.ref}]` : title} a confidence`)
    }
  }
  return left
}

export const isDone = (claim: WorkClaim, draft: Draft, references: Reference[]) =>
  remaining(claim, draft, references).length === 0

const draftOf = (drafts: Record<string, Draft>, id: string) => drafts[id] ?? emptyDraft()

/** Finished means decided everywhere and written down. An unsaved draft is not finished. */
export function isSavedDone(
  claim: WorkClaim,
  drafts: Record<string, Draft>,
  saved: Record<string, Draft>,
  references: Reference[],
): boolean {
  const draft = draftOf(drafts, claim.claim_id)
  return isDone(claim, draft, references) && sameDraft(draft, saved[claim.claim_id])
}

/** The next claim that is not finished, after `from`, wrapping around. Never `from` itself. */
export function nextUnfinishedIndex(
  claims: WorkClaim[],
  drafts: Record<string, Draft>,
  saved: Record<string, Draft>,
  references: Reference[],
  from: number,
): number | null {
  for (let step = 1; step < claims.length; step++) {
    const index = (from + step) % claims.length
    if (!isSavedDone(claims[index], drafts, saved, references)) return index
  }
  return null
}

/** The earliest claim that is not finished, for the progress count. */
export function firstUnfinishedIndex(
  claims: WorkClaim[],
  drafts: Record<string, Draft>,
  saved: Record<string, Draft>,
  references: Reference[],
): number | null {
  const index = claims.findIndex((claim) => !isSavedDone(claim, drafts, saved, references))
  return index < 0 ? null : index
}

export type SaveNext = { kind: 'claim'; index: number } | { kind: 'paper-done' } | { kind: 'stay' }

/**
 * Where "Save and next" goes. An unfinished claim later in the paper wins, then one earlier.
 * Saving the last unfinished claim says the paper is done. When every claim was already
 * finished, it moves to the next one in order.
 */
export function saveNextTarget(
  claims: WorkClaim[],
  drafts: Record<string, Draft>,
  saved: Record<string, Draft>,
  references: Reference[],
  index: number,
): SaveNext {
  const open = nextUnfinishedIndex(claims, drafts, saved, references, index)
  if (open != null) return { kind: 'claim', index: open }
  const claim = claims[index]
  if (!claim) return { kind: 'stay' }
  const draft = draftOf(drafts, claim.claim_id)
  const wasSavedDone = Boolean(saved[claim.claim_id] && isDone(claim, saved[claim.claim_id], references))
  if (isDone(claim, draft, references) && !wasSavedDone) return { kind: 'paper-done' }
  if (index + 1 < claims.length) return { kind: 'claim', index: index + 1 }
  if (isDone(claim, draft, references)) return { kind: 'paper-done' }
  return { kind: 'stay' }
}

/** The next paper in the signed-in person's topic: an unfinished one first, else any other. */
export function nextPaperInTopic(pool: Pool, analysisId: string): Pool['papers'][number] | null {
  const topic = pool.people.find((person) => person.name === pool.me)?.topic ?? ''
  if (!topic) return null
  const blind = new Set(pool.blind ?? [])
  const rest = pool.papers.filter(
    (paper) =>
      paper.analysis_id !== analysisId &&
      paper.topic === topic &&
      paper.status === 'done' &&
      !blind.has(paper.analysis_id),
  )
  return rest.find((paper) => paper.claims > 0 && paper.judged < paper.claims) ?? rest[0] ?? null
}

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
      confidence: label.confidence ?? '',
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
