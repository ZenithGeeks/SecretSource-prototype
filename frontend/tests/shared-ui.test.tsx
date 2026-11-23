/**
 * The redesign pieces every role shares (#713): the verdict bar and legend, the Ask panel's
 * verdict stamps, and the error state that sits beside Empty and LoadingScreen.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { Stamp } from '../src/components/Stamp'
import { VerdictBar, VerdictLegend } from '../src/components/VerdictBar'
import { ErrorState, LoadingScreen } from '../src/components/ui'
import { STAMPS } from '../src/lib/stamps'

const counts = { supports: 3, refutes: 1, insufficient: 0, unavailable: 2, unchecked: 4 }

describe('VerdictBar and VerdictLegend', () => {
  test('the bar names the counts of the verdicts it draws, with a segment per verdict that has one', () => {
    render(<VerdictBar counts={counts} />)
    const bar = screen.getByRole('img')
    expect(bar.getAttribute('aria-label')).toContain('3 supported')
    expect(bar.getAttribute('aria-label')).toContain('2 unavailable')
    expect(bar.getAttribute('aria-label')).toContain('4 not checked')
    expect(bar.children).toHaveLength(4) // supports, refutes, unavailable, unchecked: never all green
  })

  test('with nothing checked the bar keeps its shape as one muted track', () => {
    render(<VerdictBar counts={{ supports: 0, refutes: 0, insufficient: 0, unavailable: 0, unchecked: 2 }} />)
    expect(screen.getByRole('img').children).toHaveLength(1)
  })

  test('the legend lists each verdict with its count', () => {
    render(<VerdictLegend counts={counts} />)
    expect(screen.getByText(/3 supported/)).toBeInTheDocument()
    expect(screen.getByText(/1 contradicted/)).toBeInTheDocument()
  })
})

describe('Stamp', () => {
  test('says the verdict in the Ask panel words', () => {
    render(
      <>
        <Stamp verdict="supports" />
        <Stamp verdict="refutes" />
        <Stamp verdict="insufficient" />
        <Stamp verdict="checking" />
      </>,
    )
    for (const label of ['Backed', 'Contradicted', 'Silent', 'Checking…']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(STAMPS.unchecked.label).toBe('Not checked')
  })

  test('shows a spinner only while checking', () => {
    const { container, rerender } = render(<Stamp verdict="checking" />)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    rerender(<Stamp verdict="supports" />)
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})

describe('ErrorState', () => {
  test('is an alert with what failed and a Retry when one is given', () => {
    const onRetry = vi.fn()
    render(<ErrorState title="Could not load the Library" message="503: the gateway is down" onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not load the Library')
    expect(alert).toHaveTextContent('503: the gateway is down')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith() // not the click event
  })

  test('Retry does not submit a form it sits in', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <ErrorState title="Could not save" message="503" onRetry={() => {}} />
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('has no button without onRetry', () => {
    render(<ErrorState title="Not found" message="This draft no longer exists." />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('LoadingScreen', () => {
  afterEach(() => vi.useRealTimers())

  test('says nothing extra at first, then admits a slow load after ten seconds', () => {
    vi.useFakeTimers()
    render(<LoadingScreen label="Loading the graph…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading the graph…')
    expect(screen.queryByText(/taking longer than usual/)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByText(/taking longer than usual/)).toBeInTheDocument()
  })
})
