/** Keyboard behavior for a dropdown menu (the WAI-ARIA menu button pattern): the first item takes
 * focus when the menu opens, the arrow keys, Home and End move between items, and Escape closes
 * the menu and puts focus back on the button that opened it. */

import { type KeyboardEvent, type RefObject, useEffect } from 'react'

export function useMenuKeys(open: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, root])

  // The handler goes on the element that holds the button and the menu, so currentTarget is that element.
  return (event: KeyboardEvent<HTMLElement>) => {
    if (!open) return
    if (event.key === 'Escape') {
      close()
      event.currentTarget.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
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
}
