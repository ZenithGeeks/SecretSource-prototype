/**
 * What this browser last had open in Ask, so a refresh reopens it. The chat itself stays on
 * the server; this only remembers which one, whether the panel was open, and Answer, Do it,
 * or a screen's own mode. Do it conversations are not stored: they live in the gateway's
 * memory for an hour, so a refresh starts that mode empty.
 *
 * Keys include the signed-in user id. Another account on this browser has its own, and
 * login being off (no user id) uses the scope `local`, which is not an account. A private
 * window can throw on every localStorage call, so each one is caught.
 */

import { sessionStorageKey } from './supabase'
import { useAuth } from './useAuth'

const PREFIX = 'secretsource.ask'

export type AskPanelMode = 'answer' | 'extra' | 'do'

const MODES: readonly AskPanelMode[] = ['answer', 'extra', 'do']

function scope(userId: string | null): string {
  return userId || 'local'
}

function storageKey(userId: string | null, part: 'chat' | 'open' | 'mode'): string {
  return `${PREFIX}.${part}.${scope(userId)}`
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable, for example a private window */
  }
}

/** The user id inside a Supabase session blob, or null when it is not one. */
export function userIdFromStoredSession(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as { user?: { id?: unknown }; currentSession?: { user?: { id?: unknown } } }
    const id = record.user?.id ?? record.currentSession?.user?.id
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/** The signed-in user id already in this browser, before `getSession` resolves. Null when
 * login is off or the stored session cannot be read. */
export function signedInUserId(): string | null {
  if (!sessionStorageKey) return null
  return userIdFromStoredSession(read(sessionStorageKey))
}

/** The user whose Ask state to read and write. While auth is still resolving, the id in
 * storage is the one this browser is signed in as, so the panel does not flash shut. */
export function useAskUserId(): string | null {
  const { session, loading } = useAuth()
  if (loading) return signedInUserId()
  return session?.user.id || null
}

export function loadAskChat(userId: string | null): string | null {
  const id = read(storageKey(userId, 'chat'))
  return id && id.trim() ? id : null
}

export function saveAskChat(userId: string | null, id: string | null): void {
  write(storageKey(userId, 'chat'), id && id.trim() ? id : null)
}

export function loadAskOpen(userId: string | null): boolean {
  return read(storageKey(userId, 'open')) === '1'
}

export function saveAskOpen(userId: string | null, open: boolean): void {
  write(storageKey(userId, 'open'), open ? '1' : '0')
}

export function loadAskMode(userId: string | null): AskPanelMode | null {
  const value = read(storageKey(userId, 'mode'))
  return MODES.includes(value as AskPanelMode) ? (value as AskPanelMode) : null
}

export function saveAskMode(userId: string | null, mode: AskPanelMode): void {
  write(storageKey(userId, 'mode'), mode)
}
