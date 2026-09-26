import { useSyncExternalStore } from 'react'

export type TeacherPreferences = {
  citationStyle: string
  matchStrictness: string
  checkOnSubmit: boolean
  flagQuotes: boolean
  defaultClassId: string
  hideStudentNames: boolean
  studentReportVisibility: boolean
  sendReportsAs: string
  weeklyDigest: boolean
  digestDay: string
  batchFinishedNotification: boolean
}

export const TEACHER_PREFERENCES_KEY = 'secretsource.teacher-settings'

const DEFAULTS: TeacherPreferences = {
  citationStyle: 'APA 7th',
  matchStrictness: 'Balanced',
  checkOnSubmit: true,
  flagQuotes: true,
  defaultClassId: 'class-literary-2b',
  hideStudentNames: false,
  studentReportVisibility: true,
  sendReportsAs: 'Alex S.',
  weeklyDigest: true,
  digestDay: 'Monday',
  batchFinishedNotification: true,
}

const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function load(): TeacherPreferences {
  const saved = storage()?.getItem(TEACHER_PREFERENCES_KEY)
  if (!saved) return { ...DEFAULTS }
  try {
    const parsed: unknown = JSON.parse(saved)
    if (!isRecord(parsed)) return { ...DEFAULTS }
    const next = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS) as (keyof TeacherPreferences)[]) {
      const value = parsed[key]
      if (typeof value === typeof DEFAULTS[key]) next[key] = value as never
    }
    return next
  } catch {
    return { ...DEFAULTS }
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
  preferences = { ...DEFAULTS }
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
