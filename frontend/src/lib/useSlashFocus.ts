/** The "/" shortcut: pressing it anywhere on a screen puts focus in that screen's search or question
 * box, as on GitHub. It does nothing while the reader is already typing in a field, and it leaves
 * out keys held with Ctrl, Alt or Meta so it never takes a browser shortcut. */

import { type RefObject, useEffect } from 'react'

const TYPING = 'input, textarea, select, [contenteditable="true"]'

export function useSlashFocus(target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey) return
      if ((event.target as HTMLElement).closest(TYPING)) return
      event.preventDefault()
      target.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [target])
}
