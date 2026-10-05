import { useEffect, useState } from 'react'

/** The value once it has stopped changing for `ms` — typing in a search box or the editor
 * without a request or a render per keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}
