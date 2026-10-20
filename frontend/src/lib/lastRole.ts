/**
 * The role this browser opened last, so a returning visitor goes straight to their home
 * instead of the role picker. `?role=` in the URL still wins; sign-out forgets it.
 */

import type { Role } from './roles'
import { ROLE_INFO } from './roles'

const KEY = 'secretsource.lastRole'

/** Also checks `?role=`. An old saved or linked `app` is no longer a screen, so it fails. */
export function isRole(value: string | null): value is Role {
  return value !== null && Object.hasOwn(ROLE_INFO, value)
}

export function loadLastRole(): Role | null {
  try {
    const value = localStorage.getItem(KEY)
    return isRole(value) ? value : null
  } catch {
    return null
  }
}

export function saveLastRole(role: Role): void {
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
