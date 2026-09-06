/** Typed client for the gateway (api.py). Every call goes through the /api proxy. */

export type Citation = {
  title: string
  authors: string[]
  year: string
  doi: string
  arxiv: string
  url: string
}

export type Verdict = {
  verdict: 'supports' | 'refutes' | 'insufficient'
  quote: string
  reasoning: string
  source: string
  cited?: string // what we looked the source up by, which is how a citation finds its verdict
  evidence: { text: string; page: number; start: number; end: number; score: number }[]
  /** Pages whose images match the claim — empty unless the ColPali service is running. */
  // What the cited paper *shows* that matches: a cropped figure where one was found,
  // a whole page where none was (#29). `image` is the crop on disk, for #36 to render.
  pages?: {
    page: number
    score: number
    kind?: 'figure' | 'page'
    label?: string
    caption?: string
    image?: string
  }[]
  page_model?: string // the checkpoint that matched them, e.g. vidore/colqwen2-v1.0
}

/** Where a sentence sits in the PDF. Boxes are top-left origin, in PDF points. */
export type Source = {
  page: number
  boxes: { x0: number; y0: number; x1: number; y1: number }[]
  page_width: number
  page_height: number
}

export type Claim = {
  claim: string
  citations: Citation[]
  verdicts?: Verdict[]
  unchecked?: Unchecked[] // cited works we tried and could not read
  sentence?: string // the paper's own wording, which the claim paraphrases
  source?: Source | null // null when that sentence could not be found in the PDF
}

export type Stage = {
  stage: 'extracting' | 'extracted' | 'verifying' | 'verified' | 'failed' | 'done' | 'error'
  message?: string
  claims?: number
  extracted?: number // before repeats, announcements and the cap were taken out (#55)
  windows?: number // parts the paper was read in, one model call each
  claim?: number
  source?: string
  verdict?: string
  reason?: Reason
}

/** Why a cited work could not be checked. Kept as codes so the wording lives in one place. */
export type Reason =
  | 'unresolvable'
  | 'no-open-access'
  | 'not-downloadable'
  | 'lookup-unavailable'
  | 'web-source'
  | 'indexing-failed'
  | 'failed'

export const REASONS: Record<Reason, string> = {
  unresolvable: 'no DOI or arXiv ID to look it up by',
  'no-open-access': 'no free copy published',
  'not-downloadable': 'the PDF would not download',
  'lookup-unavailable': 'the lookup service would not answer, so we could not tell',
  'web-source': 'a web page, not a paper we can check a claim against',
  'indexing-failed': 'the retrieval service could not read this paper',
  failed: 'checking it failed',
}

/**
 * What to tell a reader about a failure, including one this build has no wording for.
 *
 * The reason codes come from the gateway as plain strings, so a code added there and not
 * here used to render as nothing at all — the silence #48 is about, in the place meant to
 * cure it. Say something rather than nothing.
 */
export function reasonText(reason?: string) {
  return REASONS[reason as Reason] ?? 'checking it failed'
}

/** A cited work we tried to check and could not. */
export type Unchecked = { source: string; reason: Reason; message: string }

export type Analysis = {
  id: string
  paper: string
  status: 'running' | 'done' | 'error'
  message?: string
  file?: string
  claims: Claim[]
  stages: Stage[]
}

/** "colbert_server/papers/x.pdf" -> "x.pdf": the gateway serves papers by file name. */
export function paperName(file: string) {
  return file.split(/[\/]/).pop() ?? file
}

/** The rendered page, at a dpi that stays sharp on a retina screen without being huge. */
export function pageImageUrl(paper: string, page: number, dpi = 150) {
  return `/api/papers/${encodeURIComponent(paper)}/pages/${page}.png?dpi=${dpi}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init)
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return response.json()
}

export const api = {
  listAnalyses: () => request<Analysis[]>('/analyses'),

  getAnalysis: (id: string) => request<Analysis>(`/analyses/${id}`),

  deleteAnalysis: (id: string) => request<{ deleted: string }>(`/analyses/${id}`, { method: 'DELETE' }),

  startAnalysis: (paper: string, verify: boolean) =>
    request<{ id: string }>('/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper, verify }),
    }),

  uploadAnalysis: (file: File, verify: boolean) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ id: string }>(`/analyses/upload?verify=${verify}`, {
      method: 'POST',
      body: form,
    })
  },

  /** Where a piece of text sits in a paper. `page: null` means it could not be found. */
  findInPaper: (paper: string, q: string, page?: number) =>
    request<Source | { page: null; boxes: [] }>(
      `/papers/${encodeURIComponent(paper)}/find?q=${encodeURIComponent(q)}` +
        (page ? `&page=${page}` : ''),
    ),

  /** Subscribes to an analysis's stage events. Returns an unsubscribe function. */
  onStages: (id: string, onStage: (stage: Stage) => void) => {
    const events = new EventSource(`/api/analyses/${id}/events`)
    events.onmessage = (message) => onStage(JSON.parse(message.data))
    events.onerror = () => events.close()
    return () => events.close()
  },
}
