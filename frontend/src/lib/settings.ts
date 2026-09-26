/**
 * Account settings — a small persistent (localStorage) store with live effects. Settings are
 * account-scoped (shared across roles), so this lives outside the researcher store. Reads via
 * useSettings(); writes via updateSettings(), which persists, applies side effects (theme),
 * and notifies subscribers. Swap load/save for a /settings endpoint later.
 */

import { useSyncExternalStore } from 'react'

import { pickMatching } from './utils'

export type ThemeChoice = 'Match system' | 'Light' | 'Dark'

export type Settings = {
  displayName: string
  email: string
  avatarUrl: string // gateway path (e.g. "/api/user/avatar/me?v=…"); '' means no uploaded photo
  citationStyle: string
  strictness: string
  checkOnAdd: boolean
  flagQuotes: boolean
  groupBy: string
  smallestGroup: string
  markDisagreements: boolean
  weeklyDigest: boolean
  digestDay: string
  notifyDone: boolean
  theme: ThemeChoice
  colorBadges: boolean
}

/** Exported so the Settings modal's server sync (lib/useAccountSettings.ts) can tell which
 * keys of a fetched preferences blob belong in this store, without importing its shape twice. */
export const SETTINGS_DEFAULTS: Settings = {
  displayName: 'Alex',
  email: 'alex@kmutt.ac.th',
  avatarUrl: '',
  citationStyle: 'APA 7th',
  strictness: 'Balanced',
  checkOnAdd: true,
  flagQuotes: true,
  groupBy: 'Meaning',
  smallestGroup: '3 papers',
  markDisagreements: true,
  weeklyDigest: true,
  digestDay: 'Monday',
  notifyDone: false,
  theme: 'Match system',
  colorBadges: true,
}

const KEY = 'secretsource.settings'
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...SETTINGS_DEFAULTS }
    return { ...SETTINGS_DEFAULTS, ...pickMatching(SETTINGS_DEFAULTS, JSON.parse(raw)) }
  } catch {
    return { ...SETTINGS_DEFAULTS }
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
  settings = { ...SETTINGS_DEFAULTS }
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

/** "Good morning, Ada" — or just "Good morning" when the display name is blank, since the
 * Settings modal lets it be cleared. */
export function greeting(displayName: string): string {
  const name = displayName.trim()
  return name ? `Good morning, ${name}` : 'Good morning'
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
