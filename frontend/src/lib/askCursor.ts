/** What the AI cursor (components/AiCursor) points at, and how each of its reactions looks. */

import { Check, CircleHelp, Flag, Loader2, MousePointer2 } from 'lucide-react'

/** An element on the page the cursor can point at. */
export type AskTarget = {
  kind: 'claim' | 'passage' | 'reference' | 'statement' | 'question' | 'screen' | 'field' | 'paper'
  id: string
}

/** The `data-ask-target` value that marks an element as `target`; the cursor finds it by this. */
export const askTarget = ({ kind, id }: AskTarget) => `${kind}:${id}`

/** Where the cursor is and what it says there; `tone: 'reading'` while the AI is still working.
 * `label` replaces the tone's own words, as when the screen agent points with a note. */
export type Pointing = { target: AskTarget; tone: keyof typeof TONES; label?: string }

/** How each tone looks, on the cursor and in a findings list. */
export const TONES = {
  reading: { label: 'Reading…', icon: Loader2, text: 'text-accent', ring: 'border-accent', chip: 'bg-accent text-canvas' },
  agrees: { label: 'Looks right', icon: Check, text: 'text-supports', ring: 'border-supports', chip: 'bg-supports text-canvas' },
  flags: { label: 'Check this', icon: Flag, text: 'text-refutes', ring: 'border-refutes', chip: 'bg-refutes text-canvas' },
  asks: { label: 'A question', icon: CircleHelp, text: 'text-insufficient', ring: 'border-insufficient', chip: 'bg-insufficient text-canvas' },
  shows: { label: 'Here', icon: MousePointer2, text: 'text-accent', ring: 'border-accent', chip: 'bg-accent text-canvas' },
} as const

/** A box on screen, in viewport pixels. */
export type Box = { top: number; left: number; width: number; height: number }

/**
 * The part of the element that shows: its box clipped to every scrolling panel around it and to
 * the window, or null when none of it shows. A tall passage scrolled half out of the label panel
 * would otherwise get a ring over the tabs above the panel and the Ask panel below it.
 */
export function visibleBox(element: HTMLElement): Box | null {
  const rect = element.getBoundingClientRect()
  let top = Math.max(rect.top, 0)
  let left = Math.max(rect.left, 0)
  let bottom = Math.min(rect.bottom, window.innerHeight)
  let right = Math.min(rect.right, window.innerWidth)
  for (const panel of scrollingAncestors(element)) {
    const clip = panel.getBoundingClientRect()
    top = Math.max(top, clip.top)
    left = Math.max(left, clip.left)
    bottom = Math.min(bottom, clip.bottom)
    right = Math.min(right, clip.right)
  }
  if (bottom < top || right < left) return null
  return { top, left, width: right - left, height: bottom - top }
}

/** The element's ancestors that clip it: each scrolls or hides its overflow. */
export function scrollingAncestors(element: HTMLElement): HTMLElement[] {
  const panels = []
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) panels.push(parent)
  }
  return panels
}
