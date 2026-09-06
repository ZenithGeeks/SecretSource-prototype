/**
 * The one seam between pages and fake data. Every service function goes through
 * `resolveMock`, so swapping to a real backend later means editing this file and the
 * per-entity service files — never a page or component.
 */

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'

function randomDelay() {
  return 200 + Math.random() * 400
}

/** `?mockState=loading|empty|error` forces a state, for demoing the four page states. */
function forcedState(): 'loading' | 'empty' | 'error' | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('mockState')
  return value === 'loading' || value === 'empty' || value === 'error' ? value : null
}

/**
 * Resolves `value` after an artificial delay, honoring a forced dev state:
 * `loading` never resolves, `empty` resolves to `emptyValue`, `error` throws.
 */
export async function resolveMock<T>(value: T, emptyValue: T): Promise<T> {
  const forced = forcedState()
  if (forced === 'loading') return new Promise<T>(() => {})
  await new Promise((resolve) => setTimeout(resolve, randomDelay()))
  if (forced === 'error') throw new Error('This is a forced mock error (?mockState=error).')
  if (forced === 'empty') return emptyValue
  return value
}
