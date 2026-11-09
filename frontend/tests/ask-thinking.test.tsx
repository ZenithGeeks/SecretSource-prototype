/** What Ask shows while it reads: the seconds go up, and under reduced motion only they move. */

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ThinkingState } from '../src/components/ThinkingState'

// framer-motion reads this setting once and then listens for a change, so the test changes it the
// way a reader's system would.
const media = vi.hoisted(() => ({ matches: false, listeners: [] as (() => void)[] }))

vi.stubGlobal('matchMedia', () => ({
  get matches() {
    return media.matches
  },
  addEventListener: (_event: string, listener: () => void) => media.listeners.push(listener),
  removeEventListener() {},
}))

afterEach(() => vi.useRealTimers())

function preferReducedMotion(reduce: boolean) {
  media.matches = reduce
  act(() => media.listeners.forEach((listener) => listener()))
}

describe('the thinking state', () => {
  it('counts the seconds since it appeared', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    render(<ThinkingState label="Reading your papers…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Reading your papers…')
    expect(screen.getByText('0s')).toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(3200))

    expect(screen.getByText('3s')).toBeInTheDocument()
  })

  it('animates the dots, unless the reader asked for less motion', async () => {
    // The animated dots carry a transform of their own; still ones carry no style at all.
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    const { container, unmount } = render(<ThinkingState label="Reading…" />)
    await settle()
    expect(container.querySelectorAll('span[style*="transform"]')).toHaveLength(3)
    unmount()

    preferReducedMotion(true)
    const still = render(<ThinkingState label="Reading…" />)
    await settle()
    expect(still.container.querySelectorAll('span[style]')).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('Reading…')
  })
})
