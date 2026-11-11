/** Up and Down move focus from one row of a list to the next and stop at the ends, so a keyboard
 * reader does not have to Tab through every button. Put it on the `<ul>`; the first button of each
 * `<li>` is the row's stop, and Tab still leaves the list as usual. */

import type { KeyboardEvent } from 'react'

export function stepRows(event: KeyboardEvent<HTMLElement>) {
  const change = { ArrowDown: 1, ArrowUp: -1 }[event.key]
  if (!change) return
  event.preventDefault()
  const rows = [...event.currentTarget.querySelectorAll('li')]
  const at = rows.findIndex((row) => row.contains(document.activeElement))
  rows[Math.min(Math.max(at + change, 0), rows.length - 1)]?.querySelector('button')?.focus()
}
