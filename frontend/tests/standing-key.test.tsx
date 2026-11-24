/** StandingKey: a closed disclosure whose chevron follows its open state. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { StandingCounts, StandingKey } from '../src/components/StandingKey'

it('turns the chevron down when the key opens and back when it closes', () => {
  const { container } = render(<StandingKey />)
  const details = container.querySelector('details') as HTMLDetailsElement
  const chevron = () => screen.getByText('What do these mean?').querySelector('svg')!
  expect(chevron().getAttribute('class')).toContain('lucide-chevron-right')
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(chevron().getAttribute('class')).toContain('lucide-chevron-down')
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(chevron().getAttribute('class')).toContain('lucide-chevron-right')
})

it('has the page-help id and a "How to read an analysis" section', () => {
  const { container } = render(<StandingKey />)
  expect(container.querySelector('details')).toHaveAttribute('id', 'page-help')
  expect(screen.getByRole('heading', { name: 'How to read an analysis' })).toBeInTheDocument()
})

/** Opens the key the way a click on its summary does, so the light-dismiss listeners are on. */
function openKey(container: HTMLElement) {
  const details = container.querySelector('details') as HTMLDetailsElement
  act(() => {
    details.open = true
    details.dispatchEvent(new Event('toggle'))
  })
  return details
}

it('closes when the reader clicks outside it', () => {
  const { container } = render(
    <>
      <StandingKey />
      <button>Elsewhere</button>
    </>,
  )
  const details = openKey(container)
  fireEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
  expect(details.open).toBe(false)
})

it('closes when focus moves to a button outside it', () => {
  const { container } = render(
    <>
      <StandingKey />
      <button>Elsewhere</button>
    </>,
  )
  const details = openKey(container)
  act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
  expect(details.open).toBe(false)
})

it('leaves focus moved by a click to the click, which then closes it', () => {
  const { container } = render(
    <>
      <StandingKey />
      <button>Elsewhere</button>
    </>,
  )
  const details = openKey(container)
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
  fireEvent.pointerDown(elsewhere)
  act(() => elsewhere.focus())
  expect(details.open).toBe(true)
  fireEvent.click(elsewhere)
  expect(details.open).toBe(false)
})

it('stays open when the reader clicks inside it', () => {
  const { container } = render(<StandingKey />)
  const details = openKey(container)
  fireEvent.click(screen.getByText('Claim'))
  expect(details.open).toBe(true)
})

it('shows only the worst badges up to the limit and names the rest in a "+N" badge', () => {
  render(
    <StandingCounts
      limit={3}
      counts={{ refutes: 1, insufficient: 2, unchecked: 0, supports: 3, named: 4, uncited: 5 }}
    />,
  )
  expect(screen.getAllByText(/: \d/)).toHaveLength(3)
  expect(screen.getByText('+2')).toHaveAttribute('title', expect.stringContaining('No citation: 5'))
})
