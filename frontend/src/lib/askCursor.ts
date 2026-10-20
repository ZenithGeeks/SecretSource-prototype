/** What the AI cursor (components/AiCursor) points at, and how each of its reactions looks. */

import { Check, CircleHelp, Flag, Loader2 } from 'lucide-react'

/** An element on the page the cursor can point at. */
export type AskTarget = { kind: 'claim' | 'passage' | 'reference' | 'statement' | 'question'; id: string }

/** The `data-ask-target` value that marks an element as `target`; the cursor finds it by this. */
export const askTarget = ({ kind, id }: AskTarget) => `${kind}:${id}`

/** Where the cursor is and what it says there; `tone: 'reading'` while the AI is still working. */
export type Pointing = { target: AskTarget; tone: keyof typeof TONES }

/** How each tone looks, on the cursor and in a findings list. */
export const TONES = {
  reading: { label: 'Reading…', icon: Loader2, text: 'text-accent', ring: 'border-accent', chip: 'bg-accent text-canvas' },
  agrees: { label: 'Looks right', icon: Check, text: 'text-supports', ring: 'border-supports', chip: 'bg-supports text-canvas' },
  flags: { label: 'Check this', icon: Flag, text: 'text-refutes', ring: 'border-refutes', chip: 'bg-refutes text-canvas' },
  asks: { label: 'A question', icon: CircleHelp, text: 'text-insufficient', ring: 'border-insufficient', chip: 'bg-insufficient text-canvas' },
} as const
