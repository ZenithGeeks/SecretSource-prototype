/**
 * Typed client for the account-level Settings endpoints (backend/app/main.py's /user/* routes).
 * Shared by every role's Settings modal — preferences are one JSON blob per signed-in user,
 * not scoped to a role.
 */

import { request } from './api'

export type DeleteScope = 'researcher' | 'author'

/** One fact the assistant remembers about the signed-in user (backend/app/memories.py). */
export type Memory = {
  id: string
  kind: 'paper' | 'concept' | 'question'
  subject: string
  summary: string
  analysis_id: string | null
  session_id: string
  created_at: string
  updated_at: string
}

/** The query key of the remembered facts. "Delete all" forgets them too and refreshes this list. */
export const MEMORIES_KEY = ['memories'] as const

export const accountApi = {
  getPreferences: () => request<Record<string, unknown>>('/user/preferences'),

  patchPreferences: (patch: Record<string, unknown>) =>
    request<Record<string, unknown>>('/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch }),
    }),

  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ url: string }>('/user/avatar', { method: 'POST', body: form })
  },

  removeAvatar: () => request<{ deleted: true }>('/user/avatar', { method: 'DELETE' }),

  /** Deletes what the signed-in user owns in one role: `researcher` is the paper analyses and
   * researcher projects, `author` the draft checks and the Author role's drafts, projects and
   * saved sources. Each role's Settings tab passes its own scope, so clearing one never touches
   * the other (PR #291 review). Analyses (and draft checks) still running are left to finish
   * and counted in `skipped`. Teacher data has no backend store yet (its mocks are local-only),
   * so its own "Delete all" clears that local store instead of calling this. */
  deleteAllData: (scope: DeleteScope) =>
    request<{ deleted: number; skipped: number }>(`/user/data?scope=${scope}`, { method: 'DELETE' }),

  /** What the assistant remembers, most recently updated first. With login off there is no user,
   * so the list is empty. An answer that is not a list is treated as empty. */
  listMemories: async () => {
    const facts = await request<Memory[]>('/memories')
    return Array.isArray(facts) ? facts : []
  },

  /** Forgets one fact. The gateway answers 404 for an id that is not the caller's. */
  deleteMemory: (id: string) =>
    request<{ deleted: number }>(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Forgets every fact. "Delete all" for the researcher scope does this too. */
  deleteAllMemories: () => request<{ deleted: number }>('/memories', { method: 'DELETE' }),
}
