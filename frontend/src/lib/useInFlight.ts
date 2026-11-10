import { useCallback, useRef, useState } from 'react'

/**
 * One run of an action at a time: a second call while one is in flight is dropped, so a double
 * click on "+ New draft" makes one draft (SCRUM-477). The ref answers at once, before React has
 * re-rendered the button as disabled; `busy` is for that disabled state.
 */
export function useInFlight(): { busy: boolean; run: (action: () => Promise<unknown>) => Promise<void> } {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await action()
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
