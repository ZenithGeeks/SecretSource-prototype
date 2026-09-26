/**
 * Typed client for the account-level Settings endpoints (backend/app/main.py's /user/* routes).
 * Shared by every role's Settings modal — preferences are one JSON blob per signed-in user,
 * not scoped to a role.
 */

import { request } from './api'

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

  /** Deletes every analysis, researcher project, and Author draft, project and saved source
   * the signed-in user owns. Analyses (and draft checks) still running are left to finish and
   * counted in `skipped`. Teacher data has no backend store yet (its mocks are local-only), so
   * its own "Delete all" clears that local store instead of calling this. */
  deleteAllData: () => request<{ deleted: number; skipped: number }>('/user/data', { method: 'DELETE' }),
}
