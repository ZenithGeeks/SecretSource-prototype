/** Where the signed-in user's uploaded photo is fetched from, for Settings and the profile chip. */

import { API_BASE } from './api'

/** Avatar initials from the display name ("Alex S." -> "AS"), or "?" for a blank name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** `avatarUrl` round-trips through the server's freeform preferences blob (PreferencesPatch
 * accepts any JSON), so a crafted PATCH could point it at an external URL — and it feeds
 * AuthorizedImage, which attaches the signed-in user's Bearer token to whatever it's given.
 * Only ever trust our own gateway path, never fetch a stored URL as this user against
 * somewhere else. */
function isOwnAvatarUrl(url: string): boolean {
  return url.startsWith('/api/user/avatar/')
}

/** The stored value is the gateway's bare `/api/user/avatar/me?v=…` path; it is prefixed
 * with API_BASE only here, at render, the way figureImageUrl does, so it still reaches the
 * gateway when the frontend is served from another origin (VITE_GATEWAY_URL). */
export function avatarPhotoUrl(stored: string): string | undefined {
  return stored && isOwnAvatarUrl(stored) ? `${API_BASE}${stored}` : undefined
}
