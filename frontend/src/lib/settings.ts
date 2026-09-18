/**
 * Account settings — a small persistent (localStorage) store with live effects. Settings are
 * account-scoped (shared across roles), so this lives outside the researcher store. Reads via
 * useSettings(); writes via updateSettings(), which persists, applies side effects (theme),
 * and notifies subscribers. Swap load/save for a /settings endpoint later.
 */

import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'Match system' | 'Light' | 'Dark'

export type Settings = {
  displayName: string
  email: string
  paperVersion: string
  strictness: string
  checkOnAdd: boolean
  flagQuotes: boolean
  groupBy: string
  smallestGroup: string
  markDisagreements: boolean
  weeklyDigest: boolean
  digestDay: string
  notifyConflict: boolean
  notifyDone: boolean
  theme: ThemeChoice
  colorBadges: boolean
}

const DEFAULTS: Settings = {
  displayName: 'Wittawat',
  email: 'wittawat@kmutt.ac.th',
  paperVersion: 'Newest',
  strictness: 'Balanced',
  checkOnAdd: true,
  flagQuotes: true,
  groupBy: 'Meaning',
  smallestGroup: '3 papers',
  markDisagreements: true,
  weeklyDigest: true,
  digestDay: 'Monday',
  notifyConflict: true,
  notifyDone: false,
  theme: 'Match system',
  colorBadges: true,
}

const KEY = 'secretsource.settings'
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

let settings: Settings = load()

export function getSettings(): Settings {
  return settings
}

export function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
  if ('theme' in patch) applyTheme(settings.theme)
  listeners.forEach((notify) => notify())
}

/** Wipe the stored settings back to defaults — call on sign-out so the next user on this
 * browser doesn't inherit the previous user's name, email, or preferences. */
export function resetSettings(): void {
  settings = { ...DEFAULTS }
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable */
  }
  applyTheme(settings.theme)
  listeners.forEach((notify) => notify())
}

/** Manual theme wins over the OS: set data-theme for Light/Dark, clear it for Match system
 * (which falls back to prefers-color-scheme). Called on load and on every theme change. */
export function applyTheme(theme: ThemeChoice = settings.theme): void {
  const root = document.documentElement
  if (theme === 'Light') root.dataset.theme = 'light'
  else if (theme === 'Dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSettings,
    getSettings,
  )
}
