/** Which parts of the claim cards the reader opened, by claim and part. AnalysisView keeps one
 * map per analysis, so a filter that hides a card, or a re-render that remounts it, does not fold
 * what the reader opened. Without a provider each card keeps its own state. */

import { createContext, useContext, useState } from 'react'

export const OpenParts = createContext<Map<string, boolean> | null>(null)

/** useState for an open/closed part, remembered in OpenParts under `key`. */
export function useOpenPart(key: string, initial: boolean) {
  const parts = useContext(OpenParts)
  const [open, setOpen] = useState(() => parts?.get(key) ?? initial)
  const change = (next: boolean) => {
    parts?.set(key, next)
    setOpen(next)
  }
  return [open, change] as const
}
