import { useSyncExternalStore } from 'react'

import { pickMatching } from './utils'

// Checking defaults (citation style, strictness, check-on-add, flag-quotes) and notifications
// (weekly digest, digest day, check-finished) moved to the shared lib/settings.ts Settings
// store when Settings became one modal shared by every role (Figma 22): they were duplicate
// state with no other reader. What's left here is genuinely teacher-only — the "Class and
// marking" tab, which has no equivalent for writer or researcher.
export type TeacherPreferences = {
  defaultClassId: string
  hideStudentNames: boolean
  studentReportVisibility: boolean
  sendReportsAs: string
}

export const TEACHER_PREFERENCES_KEY = 'secretsource.teacher-settings'

/** Exported so the Settings modal's server sync (lib/useAccountSettings.ts) can tell which
 * keys of a fetched preferences blob belong in this store. */
export const TEACHER_PREFERENCES_DEFAULTS: TeacherPreferences = {
  defaultClassId: 'class-literary-2b',
  hideStudentNames: false,
  studentReportVisibility: true,
  sendReportsAs: 'Wittawat S.',
}

const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function load(): TeacherPreferences {
  const saved = storage()?.getItem(TEACHER_PREFERENCES_KEY)
  if (!saved) return { ...TEACHER_PREFERENCES_DEFAULTS }
  try {
    const parsed: unknown = JSON.parse(saved)
    return { ...TEACHER_PREFERENCES_DEFAULTS, ...pickMatching(TEACHER_PREFERENCES_DEFAULTS, parsed) }
  } catch {
    return { ...TEACHER_PREFERENCES_DEFAULTS }
  }
}

let preferences = load()

export function getTeacherPreferences(): TeacherPreferences {
  return preferences
}

export function updateTeacherPreferences(patch: Partial<TeacherPreferences>): TeacherPreferences {
  preferences = { ...preferences, ...patch }
  try {
    storage()?.setItem(TEACHER_PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    /* Storage is optional in the local test/browser environment. */
  }
  listeners.forEach((listener) => listener())
  return preferences
}

export function resetTeacherPreferences(): void {
  preferences = { ...TEACHER_PREFERENCES_DEFAULTS }
  try {
    storage()?.removeItem(TEACHER_PREFERENCES_KEY)
  } catch {
    /* Storage is optional in the local test/browser environment. */
  }
  listeners.forEach((listener) => listener())
}

export function useTeacherPreferences(): TeacherPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getTeacherPreferences,
    getTeacherPreferences,
  )
}
