/** Keyboard behavior for a dropdown menu (the WAI-ARIA menu button pattern): the first item takes
 * focus when the menu opens, the arrow keys, Home and End move between items, Escape closes only
 * the menu and puts focus back on the button that opened it, and leaving the menu closes it.
 * `returnFocus` is for an item that opens something else: call it first, so what opens
 * remembers the button, not an item that is about to disappear. */

import { type FocusEvent, type KeyboardEvent, type RefObject, useEffect } from 'react'

const TRIGGER = '[aria-haspopup="menu"]'

export function useMenuKeys(open: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, root])

  const returnFocus = () => root.current?.querySelector<HTMLElement>(TRIGGER)?.focus()

  // The handlers go on the element that holds the button and the menu, so currentTarget is that element.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!open) return
    if (event.key === 'Escape') {
      // Used up here: a page viewer behind the menu must not close on the same key.
      event.preventDefault()
      close()
      event.currentTarget.querySelector<HTMLElement>(TRIGGER)?.focus()
      return
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const target = {
      ArrowDown: items[(at + 1) % items.length],
      ArrowUp: items[(Math.max(at, 0) - 1 + items.length) % items.length],
      Home: items[0],
      End: items[items.length - 1],
    }[event.key]
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) close()
  }

  return { onKeyDown, onBlur, returnFocus }
}
