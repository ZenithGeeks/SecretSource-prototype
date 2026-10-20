/** The way into Ask: a pill that says what it asks about, and a one-time bubble saying what Ask does. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AskButton } from '../src/components/AskButton'

const PAPER = { kind: 'paper', label: 'Group Normalization' } as const

describe('the Ask AI button', () => {
  beforeEach(() => window.localStorage.removeItem('ask.introSeen'))

  it('says what it will ask about, and explains Ask once until it is dismissed', async () => {
    const { unmount } = render(<AskButton open={false} about={PAPER} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveTextContent('Ask AIabout this paper')
    expect(await screen.findByRole('note')).toHaveTextContent('every sentence in it is checked')

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
    unmount()
    render(<AskButton open={false} about={PAPER} onToggle={() => {}} />)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('opens Ask from the bubble, and the bubble does not come back', async () => {
    const onToggle = vi.fn()
    render(<AskButton open={false} about={PAPER} onToggle={onToggle} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try it' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem('ask.introSeen')).toBe('1')
  })
})
