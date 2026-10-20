/** The floating window the labeler's Ask opens in: it moves with the arrow keys as well as by
 * dragging, remembers where it was left, and closes with Escape or its close button. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FloatingPanel } from '../src/components/FloatingPanel'

function panel(onClose = vi.fn()) {
  render(
    <FloatingPanel open title="Ask AI" storageKey="test.position" onClose={onClose}>
      <p>Review this claim</p>
    </FloatingPanel>,
  )
  return onClose
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('FloatingPanel', () => {
  it('shows its content in a non-blocking window', () => {
    panel()
    const window_ = screen.getByRole('dialog', { name: 'Ask AI' })
    expect(window_).toHaveAttribute('aria-modal', 'false')
    expect(screen.getByText('Review this claim')).toBeInTheDocument()
  })

  it('moves with the arrow keys and remembers where it was left', () => {
    panel()
    const handle = screen.getByRole('button', { name: /Move Ask AI/ })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true })

    expect(JSON.parse(window.localStorage.getItem('test.position') ?? 'null')).toEqual({ x: -24, y: -96 })
  })

  it('closes with Escape or its close button', () => {
    const onClose = panel()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Ask AI' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
