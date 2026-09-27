/**
 * Settings is a modal, not a screen (Figma 22), so no `?screen=` value maps to it — but the
 * per-role Settings screens it replaced did answer `?screen=settings`, and that link may be
 * bookmarked. Each role app seeds its modal's open state from this instead of dropping to Home.
 */
export function settingsRequested(search: string): boolean {
  return new URLSearchParams(search).get('screen') === 'settings'
}
