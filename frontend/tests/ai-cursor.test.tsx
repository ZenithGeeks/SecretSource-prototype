/** The AI cursor rings only the part of its target that shows, so a passage scrolled half out of
 * the label panel does not get a ring over the tabs above it or the Ask panel below it. */

import { afterEach, describe, expect, it } from 'vitest'

import { visibleBox } from '../src/lib/askCursor'

function boxed(element: HTMLElement, top: number, bottom: number) {
  element.getBoundingClientRect = () =>
    ({ top, bottom, left: 100, right: 400, width: 300, height: bottom - top }) as DOMRect
}

/** A label panel from y=150 to y=574, holding a passage at the given place. */
function passageInPanel(top: number, bottom: number) {
  const panel = document.createElement('div')
  panel.style.overflowY = 'auto'
  boxed(panel, 150, 574)
  const passage = document.createElement('div')
  boxed(passage, top, bottom)
  panel.append(passage)
  document.body.append(panel)
  return passage
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('visibleBox', () => {
  it('keeps the whole box of a target that shows in full', () => {
    expect(visibleBox(passageInPanel(200, 400))).toEqual({ top: 200, left: 100, width: 300, height: 200 })
  })

  it('cuts a passage scrolled half out of the panel to the part that shows', () => {
    // Measured in the labeler: a passage from 150 to 640 in a panel that shows 151 to 574.
    expect(visibleBox(passageInPanel(60, 640))).toEqual({ top: 150, left: 100, width: 300, height: 424 })
  })

  it('has no box for a passage scrolled out of the panel', () => {
    expect(visibleBox(passageInPanel(600, 800))).toBeNull()
  })
})
