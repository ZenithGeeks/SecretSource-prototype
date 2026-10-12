/**
 * The labeling page's data: the gateway calls, and the pure rules that turn what a person
 * decided into the rows saved to the team's Sheet (and tell them what is still undecided).
 *
 * Nothing here decides for the person. The AI's claims and passages are what the page shows
 * first; every claim and every passage is judged by hand, and the person saves.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { API_BASE, fetchFile, request, type Source } from './api'

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

export type Reference = { reference_id: string; file: string; label: string }

/** A row as the Sheet stores it: every value a string. */
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

export type LabelStatus = { annotator: string; configured: boolean; sheet_url: string; share_with: string }

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
    origin: 'retrieved' | 'human_added'
    status: CandidateStatus
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

export type Pool = {
  topics: string[]
  me: string
  people: { name: string; topic: string }[]
  /** Analyses their owners shared with the team, each under a topic. */
  papers: { analysis_id: string; title: string; topic: string; claims: number }[]
}

const putJson = (path: string, body: unknown) =>
  request<unknown>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const labelingApi = {
  pool: () => request<Pool>('/labeling/pool'),
  setPersonTopic: (name: string, topic: string) => putJson('/labeling/people', { name, topic }),
  setPaperTopic: (analysisId: string, topic: string) =>
    putJson(`/labeling/papers/${encodeURIComponent(analysisId)}/topic`, { topic }),
  status: () => request<LabelStatus>('/labeling/status'),
  session: (analysisId: string) => request<Session>(`/labeling/sessions/${encodeURIComponent(analysisId)}`),
  save: (analysisId: string, body: Save) =>
    request<{ claims: number; candidates: number; labels: number }>(
      `/labeling/sessions/${encodeURIComponent(analysisId)}/save`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    ),
  exportCsv: (tab: 'labels' | 'claims' | 'candidates') => fetchFile(`${API_BASE}/api/labeling/export?tab=${tab}`),
}

export function useLabelStatus() {
  return useQuery({ queryKey: ['labeling', 'status'], queryFn: labelingApi.status, retry: false })
}

export function usePool() {
  return useQuery({ queryKey: ['labeling', 'pool'], queryFn: labelingApi.pool, retry: false })
}

/** Sets a person's topic (`name`) or shares one of your own analyses (`analysisId`); "" undoes it. */
export function useAssignTopic() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { topic: string; name?: string; analysisId?: string }) =>
      v.name !== undefined ? labelingApi.setPersonTopic(v.name, v.topic) : labelingApi.setPaperTopic(v.analysisId!, v.topic),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labeling', 'pool'] }),
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

/** A claim of the paper as extracted, or one the person added because extraction missed it. */
export type WorkClaim = SessionClaim & { origin: 'extracted' | 'human_added' }

export const emptyDraft = (): Draft => ({ status: null, edited: '', cands: {}, added: [], labels: {} })
export const emptyLabel = (): LabelDraft => ({ evidence: null, rationale: '', confidence: 'medium' })

/** The claims to work through: the extracted ones, then the ones this person added earlier. */
export function workClaims(session: Session): WorkClaim[] {
  const extracted = session.claims.map((c) => ({ ...c, origin: 'extracted' as const }))
  const known = new Set(session.claims.map((c) => c.claim_id))
  const added = session.saved.claims
    .filter((row) => row.origin === 'human_added' && !known.has(row.claim_id))
    .map((row) => ({
      claim_id: row.claim_id,
      claim: row.claim,
      sentence: '',
      section: row.section ?? '',
      source: null,
      candidates: [],
      origin: 'human_added' as const,
    }))
  return [...extracted, ...added]
}

const numberOrNull = (value: string | undefined) => (value && !Number.isNaN(Number(value)) ? Number(value) : null)

/** What this person already saved for a claim, as a draft to carry on from. */
export function draftFromSaved(claim: WorkClaim, saved: Session['saved']): Draft {
  const draft = emptyDraft()
  const row = saved.claims.find((r) => r.claim_id === claim.claim_id)
  if (row) {
    draft.status = row.status as ClaimStatus
    draft.edited = row.claim_edited ?? ''
  }
  for (const r of saved.candidates.filter((r) => r.claim_id === claim.claim_id)) {
    if (r.origin === 'retrieved') draft.cands[r.cand_id] = r.status as CandidateStatus
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

/** What is still undecided, in words. Empty means the claim is finished. */
export function remaining(claim: WorkClaim, draft: Draft): string[] {
  if (!draft.status) return ['Decide on the claim: keep, edit or reject it']
  if (draft.status === 'rejected') return []
  const left: string[] = []
  if (draft.status === 'edited' && !draft.edited.trim()) left.push('Write the edited claim')
  const unjudged = claim.candidates.filter((c) => !draft.cands[c.cand_id]).length
  if (unjudged) left.push(`${unjudged} passage${unjudged === 1 ? '' : 's'} not judged`)
  for (const id of referencesOf(claim, draft)) {
    if (relevantPassages(claim, draft, id).length && !draft.labels[id]?.evidence) left.push(`Label ${id}`)
  }
  return left
}

export const isDone = (claim: WorkClaim, draft: Draft) => remaining(claim, draft).length === 0

const sameAdded = (a: AddedPassage, b: AddedPassage) => a.reference_id === b.reference_id && a.passage === b.passage

/**
 * The rows to save for one claim. A rejected claim saves only that: nobody judges its passages.
 * `saved` is the draft as last saved, so a passage added then removed is retracted in the Sheet
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
    page: claim.source?.page ?? null,
    section: claim.section,
  })
  if (draft.status === 'rejected') return save

  for (const c of claim.candidates) {
    const status = draft.cands[c.cand_id]
    if (status) {
      save.candidates.push({
        claim_id: claim.claim_id,
        reference_id: c.reference_id,
        cand_id: c.cand_id,
        origin: 'retrieved',
        status,
        page: null,
        passage: '',
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

/** Claims finished, for the progress bar. */
export function progress(claims: WorkClaim[], drafts: Record<string, Draft>) {
  const done = claims.filter((c) => isDone(c, drafts[c.claim_id] ?? emptyDraft())).length
  return { done, total: claims.length }
}
