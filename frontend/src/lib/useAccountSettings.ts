/**
 * Syncs the server preferences blob (backend/app/main.py's /user/preferences) with the two
 * local stores the rest of the app already reads synchronously: lib/settings.ts's useSettings()
 * (theme, colour badges, checking/notification defaults, researcher's field-map — shared,
 * account-scoped) and lib/teacherPreferences.ts's useTeacherPreferences() (teacher-only extras).
 *
 * Those stores stay localStorage-backed for every other reader in the app (unchanged blast
 * radius); this hook only runs inside the Settings modal, once per open: it pulls the server's
 * copy in and overwrites the local one (server wins, in case another device changed it), and
 * every row's own onChange then keeps the two in sync going forward via usePatchPreference.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { accountApi } from './accountApi'
import type { Settings } from './settings'
import { getSettings, SETTINGS_DEFAULTS, updateSettings } from './settings'
import type { TeacherPreferences } from './teacherPreferences'
import { getTeacherPreferences, TEACHER_PREFERENCES_DEFAULTS, updateTeacherPreferences } from './teacherPreferences'
import { pickMatching } from './utils'

const PREFERENCES_KEY = ['account', 'preferences']

function hydrate(data: Record<string, unknown>): void {
  const settingsPatch = pickMatching(SETTINGS_DEFAULTS, data)
  if (Object.keys(settingsPatch).length) updateSettings(settingsPatch)
  const teacherPatch = pickMatching(TEACHER_PREFERENCES_DEFAULTS, data)
  if (Object.keys(teacherPatch).length) updateTeacherPreferences(teacherPatch)
}

/** Fetches the server's preferences once per modal-open and hydrates the local stores.
 * `enabled` should be the modal's open state, so a role that never opens Settings never fetches.
 *
 * Hydration happens inside the fetch and nowhere else. A PATCH response also lands in this
 * query's cache (usePatchPreference) but carries the blob as of that write — older than
 * anything typed or toggled since — so hydrating from it would revert those: lost keystrokes
 * in a text row, a fast double toggle flipping back. A fresh open re-fetches (the cached
 * data is stale at once), so another tab's or device's change still wins on open. */
export function usePreferencesSync(enabled: boolean) {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: async () => {
      const data = await accountApi.getPreferences()
      hydrate(data)
      return data
    },
    enabled,
  })
}

/** PATCHes one or more fields to the server. Call alongside a local store's optimistic write;
 * on failure, roll the local store back yourself (each row's `set` knows the previous value). */
export function usePatchPreference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => accountApi.patchPreferences(patch),
    onSuccess: (data) => queryClient.setQueryData(PREFERENCES_KEY, data),
  })
}

/** A `set(key, value)` for the shared Settings store (lib/settings.ts) that updates
 * optimistically and PATCHes the server, rolling the local value back on a failed request. */
export function useSetSetting() {
  const patch = usePatchPreference()
  return <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const previous = getSettings()[key]
    updateSettings({ [key]: value } as Partial<Settings>)
    patch.mutate(
      { [key]: value },
      { onError: () => updateSettings({ [key]: previous } as Partial<Settings>) },
    )
  }
}

/** Same as useSetSetting, for the teacher-only preferences store. */
export function useSetTeacherPreference() {
  const patch = usePatchPreference()
  return <K extends keyof TeacherPreferences>(key: K, value: TeacherPreferences[K]) => {
    const previous = getTeacherPreferences()[key]
    updateTeacherPreferences({ [key]: value } as Partial<TeacherPreferences>)
    patch.mutate(
      { [key]: value },
      { onError: () => updateTeacherPreferences({ [key]: previous } as Partial<TeacherPreferences>) },
    )
  }
}
