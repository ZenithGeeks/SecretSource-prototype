/** The way into Ask: a pill that says what it asks about, and a one-time bubble saying what Ask does. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AskButton } from '../src/components/AskButton'

const PAPER = { kind: 'paper', label: 'Group Normalization' } as const

describe('the Ask AI button', () => {
  beforeEach(() => window.localStorage.removeItem('ask.introSeen'))

  it('says what it will ask about, and explains Ask once until it is dismissed', async () => {
    const { unmount } = render(<AskButton role="researcher" open={false} about={PAPER} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveTextContent('Ask AIabout this paper')
    expect(await screen.findByRole('note')).toHaveTextContent('every sentence in it is checked')

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
    unmount()
    render(<AskButton role="researcher" open={false} about={PAPER} onToggle={() => {}} />)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('leaves the page clickable: no backdrop, and the note sits in the toolbar beside the pill (#724)', async () => {
    const onCheck = vi.fn()
    const { container } = render(
      <div>
        <AskButton role="writer" open={false} about={PAPER} onToggle={() => {}} />
        <button type="button" onClick={onCheck}>
          Re-check
        </button>
      </div>,
    )
    const note = await screen.findByRole('note')
    // Nothing covers the window: no fixed layer, and the note is in the flow, not a popover.
    expect(container.querySelector('.fixed')).toBeNull()
    expect(note.className).not.toMatch(/\b(absolute|fixed)\b/)
    expect(note.compareDocumentPosition(screen.getByRole('button', { name: 'Ask AI' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A click on the page's own action reaches it, and the note stays until it is dismissed.
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    expect(onCheck).toHaveBeenCalledOnce()
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  it('Esc dismisses the note for good', async () => {
    const { unmount } = render(<AskButton role="writer" open={false} about={PAPER} onToggle={() => {}} />)
    await screen.findByRole('note')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('ask.introSeen')).toBe('1')
    unmount()
    render(<AskButton role="writer" open={false} about={PAPER} onToggle={() => {}} />)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('clicking the Ask pill opens Ask and dismisses the note for good', async () => {
    const onToggle = vi.fn()
    render(<AskButton role="labeler" open={false} about={PAPER} onToggle={onToggle} />)
    await screen.findByRole('note')
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    expect(onToggle).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('ask.introSeen')).toBe('1')
  })

  it('× dismisses the note for good, as Got it does', async () => {
    render(<AskButton role="teacher" open={false} about={PAPER} onToggle={() => {}} />)
    await screen.findByRole('note')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('ask.introSeen')).toBe('1')
  })

  it('opens Ask from the bubble, and the bubble does not come back', async () => {
    const onToggle = vi.fn()
    render(<AskButton role="researcher" open={false} about={PAPER} onToggle={onToggle} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try it' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem('ask.introSeen')).toBe('1')
  })
})
