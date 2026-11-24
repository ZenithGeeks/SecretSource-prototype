/**
 * Roving focus: a row of related controls is one Tab stop, and the arrow keys move along it
 * (WAI-ARIA Authoring Practices, "Managing focus within components").
 */

import type { KeyboardEvent } from 'react'

const STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: -Infinity,
  End: Infinity,
}

/** The item a key moves to from `at`, or null for a key that does not move. `wrap` goes round
 * the ends, as a radio group does; without it the ends stop the move, as a toolbar does. */
export function nextIndex(key: string, at: number, count: number, wrap: boolean): number | null {
  const step = STEPS[key]
  if (step === undefined) return null
  if (!Number.isFinite(step)) return step < 0 ? 0 : count - 1
  if (wrap) return (at + step + count) % count
  return Math.min(count - 1, Math.max(0, at + step))
}

/** Moves focus among the `selector` matches inside the element the key was pressed in. */
export function moveFocus(event: KeyboardEvent<HTMLElement>, selector: string, wrap: boolean) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)]
  const next = nextIndex(event.key, items.indexOf(document.activeElement as HTMLElement), items.length, wrap)
  if (next === null) return null
  event.preventDefault()
  items[next].focus()
  return items[next]
}

/** onKeyDown for a role="radiogroup": the arrow keys move to the next radio; Space or Enter
 * chooses it. Choosing is not tied to moving, because a choice here is a label decision and
 * some groups fold away once one is made. */
export function onRadioKeys(event: KeyboardEvent<HTMLElement>) {
  // A key that moved here must not also move the page around the group (the labeler's passages).
  if (moveFocus(event, '[role="radio"]:not(:disabled)', true)) event.stopPropagation()
}

/** The Tab stop of a radio group is its checked radio, or the first one while none is. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean) {
  return checked || (!anyChecked && index === 0) ? 0 : -1
}
