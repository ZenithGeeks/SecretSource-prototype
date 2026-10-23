/** SplitPane keeps the right pane its minimum width, keeps the ratio in storage when given a key,
 * and puts the handle back on a double click. The Author editor's own test covers the keys. */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SplitPane } from '../src/components/SplitPane'

const KEY = 'test.split'

function pane(props: Partial<React.ComponentProps<typeof SplitPane>> = {}) {
  return (
    <SplitPane left={<p>left</p>} right={<p>right</p>} leftLabel="Paper" rightLabel="Claims" initialRatio={0.6} {...props} />
  )
}

describe('SplitPane', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('never leaves the right pane narrower than its minimum', () => {
    // jsdom has no layout: say the pane is 1000px wide. The right pane keeps 432px and the 6px
    // handle sits beside it, so the left pane may take 1 - 438/1000 = 0.562.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect)
    render(pane({ minRight: 432 }))
    const handle = screen.getByRole('separator')

    fireEvent.keyDown(handle, { key: 'End' })

    expect(handle).toHaveAttribute('aria-valuenow', '56')
    expect(screen.getByRole('region', { name: 'Paper' })).toHaveStyle({ maxWidth: 'calc(100% - 438px)' })
  })

  it('keeps the ratio under its key and starts from it next time', () => {
    const { unmount } = render(pane({ storageKey: KEY }))
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(window.localStorage.getItem(KEY)).toBe('0.65')

    unmount()
    render(pane({ storageKey: KEY }))

    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '65')
  })

  it('starts from the default when the stored value is not a ratio', () => {
    window.localStorage.setItem(KEY, 'wide')
    render(pane({ storageKey: KEY }))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '60')
  })

  it('puts the handle back on a double click', () => {
    render(pane({ storageKey: KEY }))
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'End' })

    fireEvent.doubleClick(handle)

    expect(handle).toHaveAttribute('aria-valuenow', '60')
    expect(window.localStorage.getItem(KEY)).toBe('0.6')
  })

  it('does not write anything without a key', () => {
    render(pane())
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(window.localStorage.length).toBe(0)
  })
})
