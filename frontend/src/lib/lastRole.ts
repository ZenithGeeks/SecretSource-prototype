/**
 * The role this browser opened last, so a returning visitor goes straight to their home
 * instead of the role picker. `?role=` in the URL still wins; sign-out forgets it.
 */

import type { Role } from './roles'

export type StoredRole = Role | 'app'

const KEY = 'secretsource.lastRole'
const STORED_ROLES: readonly StoredRole[] = ['researcher', 'writer', 'teacher', 'labeler', 'app']

export function isStoredRole(value: string | null): value is StoredRole {
  return value !== null && (STORED_ROLES as readonly string[]).includes(value)
}

export function loadLastRole(): StoredRole | null {
  try {
    const value = localStorage.getItem(KEY)
    return isStoredRole(value) ? value : null
  } catch {
    return null
  }
}

export function saveLastRole(role: StoredRole): void {
  try {
    localStorage.setItem(KEY, role)
  } catch {
    /* storage unavailable: the picker shows again next visit */
  }
}

export function clearLastRole(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable */
  }
}
