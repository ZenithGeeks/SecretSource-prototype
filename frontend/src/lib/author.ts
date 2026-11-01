/**
 * Typed client for the Author screens: every call goes to the gateway's /author routes
 * (backend/app/author/router.py), through the same `request` helper as the rest of the app,
 * so the signed-in user's token travels with it and a 401 signs out.
 */

import { request, requestBlob } from './api'
import type {
  CheckRun,
  Comparison,
  Draft,
  LibraryView,
  ParseResult,
  Project,
  ProjectDetail,
  ProjectLint,
  Resolution,
  SavedSource,
  SourceRef,
  Verdict,
} from '../types/draftCheck'

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const upload = (file: File): RequestInit => {
  const form = new FormData()
  form.append('file', file)
  return { method: 'POST', body: form }
}

const enc = encodeURIComponent

/** What PATCH /author/checks/{id}/citations/{cid} takes: the author's decision about an issue. */
export type CitationPatch = {
  resolution?: Omit<Resolution, 'at'> | null
  key?: string
  sourceRef?: SourceRef
  verdict?: Verdict
  evidence?: { passage: string; pdf: string; page: number | null }
  explanation?: string
}

export const authorApi = {
  // drafts
  listDrafts: () => request<Draft[]>('/author/drafts'),
  getDraft: (id: string) => request<Draft>(`/author/drafts/${enc(id)}`),
  createDraft: (body: { title?: string; projectId?: string | null; files?: { name: string; content: string }[] }) =>
    request<Draft>('/author/drafts', json('POST', body)),
  uploadDraft: (file: File, projectId?: string | null) =>
    request<Draft>(`/author/drafts/upload${projectId ? `?projectId=${enc(projectId)}` : ''}`, upload(file)),
  updateDraft: (id: string, body: { title?: string; projectId?: string | null }) =>
    request<Draft>(`/author/drafts/${enc(id)}`, json('PATCH', body)),
  deleteDraft: (id: string) => request<{ deleted: string }>(`/author/drafts/${enc(id)}`, { method: 'DELETE' }),
  /** `updated` is the draft's `updated` the caller last saw; with it, the gateway refuses the
   * write (409) if the draft changed since, so another tab's save is noticed, not overwritten. */
  putFile: (id: string, name: string, content: string, updated?: string) =>
    request<Draft>(`/author/drafts/${enc(id)}/files/${name.split('/').map(enc).join('/')}`, json('PUT', { content, updated })),
  deleteFile: (id: string, name: string) =>
    request<Draft>(`/author/drafts/${enc(id)}/files/${name.split('/').map(enc).join('/')}`, { method: 'DELETE' }),
  saveDraft: (id: string) => request<Draft>(`/author/drafts/${enc(id)}/save`, { method: 'POST' }),
  parseDraft: (id: string) => request<ParseResult>(`/author/drafts/${enc(id)}/parse`),
  attachPdf: (draftId: string, key: string, file: File) =>
    request<{ key: string; pdf: string }>(`/author/drafts/${enc(draftId)}/citations/${enc(key)}/pdf`, upload(file)),

  // checks
  startCheck: (draftId: string) => request<{ id: string }>(`/author/drafts/${enc(draftId)}/check`, { method: 'POST' }),
  listChecks: (draftId: string) => request<CheckRun[]>(`/author/drafts/${enc(draftId)}/checks`),
  getCheck: (id: string, signal?: AbortSignal) => request<CheckRun>(`/author/checks/${enc(id)}`, { signal }),
  compareCheck: (id: string) => request<Comparison>(`/author/checks/${enc(id)}/compare`),
  patchCitation: (checkId: string, citationId: string, patch: CitationPatch) =>
    request<CheckRun>(`/author/checks/${enc(checkId)}/citations/${enc(citationId)}`, json('PATCH', patch)),

  /** The verification report as a PDF. Rejects (a 409) before the draft was ever checked. */
  report: (draftId: string) => requestBlob(`/author/drafts/${enc(draftId)}/report`, { method: 'POST' }),

  // projects and the library
  getLibrary: () => request<LibraryView>('/author/library'),
  listProjects: () => request<Project[]>('/author/projects'),
  getProject: (id: string) => request<ProjectDetail>(`/author/projects/${enc(id)}`),
  createProject: (body: { name?: string; bib?: string; bibName?: string }) =>
    request<Project>('/author/projects', json('POST', body)),
  importProject: (file: File) => request<Project>('/author/projects/import', upload(file)),
  updateProject: (id: string, body: { name?: string; bib?: string; bibName?: string }) =>
    request<Project>(`/author/projects/${enc(id)}`, json('PATCH', body)),
  deleteProject: (id: string) => request<{ deleted: string }>(`/author/projects/${enc(id)}`, { method: 'DELETE' }),
  lintProject: (id: string) => request<ProjectLint>(`/author/projects/${enc(id)}/lint`),
  removeBibEntry: (projectId: string, key: string) =>
    request<{ removed: string; entries: number }>(`/author/projects/${enc(projectId)}/bib/${enc(key)}`, { method: 'DELETE' }),
  attachProjectPdf: (projectId: string, key: string, file: File) =>
    request<{ key: string; pdf: string }>(`/author/projects/${enc(projectId)}/bib/${enc(key)}/pdf`, upload(file)),

  // saved sources
  /** All saved sources, or one project's; '' is the unsorted ones (saved to no project). */
  listSources: (projectId?: string) =>
    request<SavedSource[]>(`/author/sources${projectId === undefined ? '' : `?project=${enc(projectId)}`}`),
  deleteSource: (id: string) => request<{ deleted: string }>(`/author/sources/${enc(id)}`, { method: 'DELETE' }),
  addSourceToBib: (id: string, projectId: string) =>
    request<SavedSource>(`/author/sources/${enc(id)}/add-to-bib`, json('POST', { projectId })),
  attachSourcePdf: (id: string, file: File) => request<SavedSource>(`/author/sources/${enc(id)}/pdf`, upload(file)),

  // your data
  exportData: () => request<Record<string, unknown>>('/author/export'),
}

/** The gateway's own words out of a failed request ("409: {"detail":"..."}" → the detail). */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const body = text.replace(/^\d{3}: /, '')
  try {
    const parsed = JSON.parse(body) as { detail?: unknown }
    if (typeof parsed.detail === 'string') return parsed.detail
  } catch {
    // not JSON
  }
  return body
}

/** "checked 2 min ago" · "checked yesterday" · "not checked yet". */
export function checkedLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'not checked yet'
  return `checked ${ago(iso, now)}`
}

/** "edited 5 min ago" for a draft's last change to its text (its `updated`). */
export function editedLabel(iso: string, now = Date.now()): string {
  return `edited ${ago(iso, now)}`
}

/** "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago". */
function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** "Checked 2 min ago" for a card footer, "Not checked yet" when never. */
export function checkedSentence(iso: string | null | undefined): string {
  const label = checkedLabel(iso)
  return label.charAt(0).toUpperCase() + label.slice(1)
}
