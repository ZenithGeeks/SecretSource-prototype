/** Typed client for the gateway (api.py). Every call goes through the /api proxy. */

import { supabase } from './supabase'
import { endSession } from './useAuth'

export type Citation = {
  title: string
  authors: string[]
  year: string
  doi: string
  arxiv: string
  url: string
  ref?: string // GROBID's id for the reference, e.g. "b12" (#123)
  label?: string // how the paper cites it, e.g. "13"; missing on older analyses
}

export type Verdict = {
  verdict: 'supports' | 'refutes' | 'insufficient'
  quote: string
  reasoning: string
  source: string
  cited?: string // what we looked the source up by, which is how a citation finds its verdict
  evidence: { text: string; page: number; start: number; end: number; score: number }[]
  /** Pages whose images match the claim — empty unless the ColPali service is running. */
  // What the cited paper *shows* that matches: a cropped figure or table where one was found,
  // a whole page where none was (#29). `image` is the crop on disk, for #36 to render.
  pages?: {
    page: number
    score: number
    kind?: 'figure' | 'table' | 'page'
    label?: string
    caption?: string
    image?: string
    region?: Source | null // the crop's box on its page (#564); null or missing on older analyses
  }[]
  page_model?: string // the checkpoint that matched them, e.g. vidore/colqwen2-v1.0
  /** Which judge call gave the verdict (#516): the passages, or the top crop when they were not
   * enough. `judged_figure` is that crop's file name, a figure or a table. */
  verdict_from?: 'text' | 'figure' | 'none'
  judged_figure?: string
  /** Set when the PDF read was the arXiv copy, not the publisher's (#424). */
  source_version?: 'preprint'
  arxiv?: string // that copy's arXiv id, e.g. "2507.11408"
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
  named?: string[] // cited works the claim only names as something the paper uses; not checked (#475)
  sentence?: string // the paper's own wording, which the claim paraphrases
  section?: string // the number of the section the sentence is in, e.g. "3.1" (#152)
  source?: Source | null // null when that sentence could not be found in the PDF
}

export type Stage = {
  stage:
    | 'queued'
    | 'extracting'
    | 'extracted'
    | 'planned'
    | 'verifying'
    | 'verified'
    | 'failed'
    | 'figures'
    | 'audited'
    | 'done'
    | 'error'
  message?: string
  claims?: number
  extracted?: number // before repeats, announcements and the cap were taken out (#55)
  windows?: number // parts the paper was read in, one model call each
  claim?: number
  source?: string
  verdict?: string
  reason?: Reason
  findings?: number // what the audit disagreed with, 0 on an ordinary run
  figures?: number // numbered figures found in the analysed paper
  checks?: number // on "planned": how many checks will run
  sources?: number // on "planned": against how many cited works
  at?: number // Unix time the stage was recorded; missing on older analyses
}

/** Why a cited work could not be checked. Kept as codes so the wording lives in one place. */
export type Reason =
  | 'unresolvable'
  | 'no-open-access'
  | 'not-downloadable'
  | 'lookup-unavailable'
  | 'web-source'
  | 'withdrawn'
  | 'indexing-failed'
  | 'failed'

export const REASONS: Record<Reason, string> = {
  unresolvable: 'no DOI or arXiv ID to look it up by',
  'no-open-access': 'no free copy published',
  'not-downloadable': 'the PDF would not download',
  'lookup-unavailable': 'the lookup service would not answer, so we could not tell',
  'web-source': 'a web page, not a paper we can check a claim against',
  withdrawn: 'withdrawn by its authors on arXiv',
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

/** Where the analysed paper cites a reference, e.g. "[13]": one box in PDF points. */
export type CitationMarker = {
  ref: string // the reference's id, a key of Analysis.references
  text: string // the marker as printed
  page: number
  x0: number
  y0: number
  x1: number
  y1: number
  page_width: number
  page_height: number
}

/** A numbered section of the analysed paper, from GROBID: where its heading is (#152). */
export type OutlineEntry = { n: string; title: string; page: number; y: number }

/** A figure of the analysed paper whose caption gives its number, e.g. "Figure 2". */
export type PaperFigure = { label: string; page: number; caption: string; image: string }

export type Analysis = {
  id: string
  paper: string
  status: 'running' | 'done' | 'error'
  message?: string
  file?: string
  title?: string // the paper's own title, from GROBID; missing on older analyses
  claims: Claim[]
  figures?: PaperFigure[] // missing on analyses from before #85, and until the run has read them
  references?: Record<string, Citation> // the references the paper's markers point to (#47)
  markers?: CitationMarker[] // missing on analyses from before #47
  outline?: OutlineEntry[] // missing on analyses from before #152
  stages: Stage[]
}

/** "colbert_server/papers/x.pdf" -> "x.pdf": the gateway serves papers by file name. */
export function paperName(file: string) {
  return file.split('/').pop() ?? file
}

/** Where the gateway lives. Empty (the default) means same-origin behind a reverse proxy, as
 * on the docker-compose and CPE Cloud deployments. Set VITE_GATEWAY_URL to call a gateway on a
 * different origin, e.g. when the frontend is hosted separately (Vercel) from the gateway. */
export const API_BASE = import.meta.env.VITE_GATEWAY_URL ?? ''

/** A figure crop, from the `image` path a verdict's `pages` entry carries. Only the file
 * name travels: the gateway builds the directory from the paper and rejects anything that
 * is not a figure-<n>. */
export function figureImageUrl(paper: string, image: string) {
  const file = image.split('/').pop()?.replace(/\.png$/, '') ?? ''  // figures.py writes as_posix()
  return `${API_BASE}/api/papers/${encodeURIComponent(paper)}/figures/${encodeURIComponent(file)}.png`
}

/** A request that could not say who is asking. The session is gone, and the app has signed out
 * so the sign-in screen shows. */
export class SignedOut extends Error {
  constructor() {
    super('the session has expired, sign in again')
  }
}

/** The signed-in user's access token, so the gateway knows whose analyses to show. Empty when
 * login is off. With login on and no session (for example a token refresh that failed), the
 * request is not sent without one, which would ask as nobody (#147): it signs out instead. */
async function accessToken() {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  if (data.session?.access_token) return data.session.access_token
  await endSession()
  throw new SignedOut()
}

/** A 401 means the gateway would not take the token: sign out rather than keep asking. */
async function signOutIfRefused(response: Response) {
  if (response.status === 401 && supabase) {
    await endSession()
    throw new SignedOut()
  }
}

/** A file from the gateway (a paper, a figure crop), fetched with the signed-in user's token:
 * the gateway serves papers only to the user whose analyses they belong to (#135). */
export async function fetchFile(url: string) {
  const token = await accessToken()
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  await signOutIfRefused(response)
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return response.blob()
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE}/api${path}`, { ...init, headers })
  await signOutIfRefused(response)
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return response
}

/** Where to PUT a PDF for a direct upload, from POST /uploads: an upload session URL, which
 * needs no credentials. `url` is null when the gateway has no papers bucket. */
type UploadTicket = { url: null } | { url: string; object: string; headers: Record<string, string> }

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json()
}

/** Like `request`, for a route that answers with a file (the Author role's PDF report). */
export async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  return (await send(path, init)).blob()
}

export const api = {
  listAnalyses: () => request<Analysis[]>('/analyses'),

  getAnalysis: (id: string, signal?: AbortSignal) => request<Analysis>(`/analyses/${id}`, { signal }),

  deleteAnalysis: (id: string) => request<{ deleted: string }>(`/analyses/${id}`, { method: 'DELETE' }),

  startAnalysis: (paper: string, verify: boolean) =>
    request<{ id: string }>('/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper, verify }),
    }),

  /** Upload a PDF and start its analysis. Where the gateway has a papers bucket, the PDF goes
   * straight to Cloud Storage through an upload session the gateway starts: the web proxy
   * refuses a body over 4.5 MB (#266). Elsewhere, local compose for example, it goes through
   * the gateway as before. */
  uploadAnalysis: async (file: File, verify: boolean) => {
    const ticket = await request<UploadTicket>('/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, size: file.size }),
    })
    if (!ticket.url) {
      const form = new FormData()
      form.append('file', file)
      return request<{ id: string }>(`/analyses/upload?verify=${verify}`, { method: 'POST', body: form })
    }
    const put = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: file })
    if (!put.ok) throw new Error(`${put.status}: the upload to storage failed`)
    return request<{ id: string }>('/analyses/from-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_name: ticket.object, verify }),
    })
  },

  /** Where a piece of text sits in a paper. `page: null` means it could not be found. */
  findInPaper: (paper: string, q: string, page?: number) =>
    request<Source | { page: null; boxes: [] }>(
      `/papers/${encodeURIComponent(paper)}/find?q=${encodeURIComponent(q)}` +
        (page ? `&page=${page}` : ''),
    ),

  /** Follows an analysis's stages over SSE. A dropped connection is usually transient, so
   * this does not stop on error: it reconnects after a pause, as EventSource would, and the
   * backend replays every stage from the start on each new connection (#133). `onOpen` fires
   * on the initial connection and on every reconnect, so a caller can resync its own
   * bookkeeping (e.g. how much of that replay to skip) each time. Returns a function that
   * closes the connection for good, for the caller to call once it knows the run ended,
   * and for cleanup on unmount.
   *
   * This reads the stream with fetch() rather than EventSource, because EventSource cannot
   * send the Authorization header, and a token in the URL ends up in access logs (#134). */
  onStages: (id: string, onStage: (stage: Stage) => void, onOpen?: () => void) =>
    followEvents<Stage>(`/analyses/${id}/events`, onStage, onOpen),
}

/**
 * Follows any of the gateway's server-sent event routes (an analysis's stages, an Author
 * draft check's), with the reconnect-and-replay behaviour `onStages` describes above. The
 * one SSE loop, so the two callers never drift apart. Returns the function that closes it.
 */
export function followEvents<T>(path: string, onEvent: (event: T) => void, onOpen?: () => void) {
  const controller = new AbortController()
  const follow = async () => {
    while (!controller.signal.aborted) {
      try {
        const token = await accessToken()
        const response = await fetch(`${API_BASE}/api${path}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        })
        // Like EventSource, a refused stream (401, 404) is not retried.
        await signOutIfRefused(response)
        if (!response.ok || !response.body) return
        onOpen?.()
        await readEvents(response.body, (data) => onEvent(JSON.parse(data)))
      } catch (error) {
        if (controller.signal.aborted || error instanceof SignedOut) return
      }
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS))
    }
  }
  void follow()
  return () => controller.abort()
}

/** EventSource's own default pause before it reconnects. */
const RECONNECT_MS = 3000

/** Calls `onData` with the data of each server-sent event in the stream, until it ends. */
async function readEvents(body: ReadableStream<Uint8Array>, onData: (data: string) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffered += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buffered.indexOf('\n\n')) !== -1) {
      const event = buffered.slice(0, end)
      buffered = buffered.slice(end + 2)
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data) onData(data)
    }
  }
}
