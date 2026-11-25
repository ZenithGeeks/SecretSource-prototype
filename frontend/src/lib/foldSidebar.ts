/** The shell's switch that folds its sidebar, for a screen that needs the width. */

import { createContext, useContext, useEffect, useRef } from 'react'

/** The sidebar of a `foldable` AppShell and its switch; null in a shell that cannot fold. */
export const FoldSidebar = createContext<{ folded: boolean; fold: (folded: boolean) => void } | null>(null)

/** Folds the sidebar while `active`, and opens it again afterwards if it was open before.
 * A person who opens or folds it by hand in between has made their own choice, which stays. */
export function useFoldWhile(active: boolean) {
  const shell = useContext(FoldSidebar)
  const folded = shell?.folded ?? false
  const fold = shell?.fold
  const foldedNow = useRef(folded)
  // True while the sidebar is folded because of this hook and should open again after.
  const reopen = useRef(false)

  // Declared first, so they run before the fold below and never see it as a change by hand.
  useEffect(() => {
    foldedNow.current = folded
    if (!folded) reopen.current = false
  }, [folded])

  useEffect(() => {
    if (!active || !fold) return
    if (!foldedNow.current) {
      reopen.current = true
      fold(true)
    }
    return () => {
      if (reopen.current) fold(false)
      reopen.current = false
    }
  }, [active, fold])
}
