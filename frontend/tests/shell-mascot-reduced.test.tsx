/** Mascot with the OS asking for reduced motion. framer-motion reads that setting once, the
 * first time any component asks, so this file answers matchMedia before anything renders. */

import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { Mascot } from '../src/components/Mascot'

window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}))

it('still draws, and takes a hover without error, when reduced motion is asked for', async () => {
  const { container } = render(<Mascot role="teacher" animated />)
  const svg = container.querySelector('svg') as SVGSVGElement

  // framer-motion reports a hover on the next animation frame.
  await act(async () => {
    svg.dispatchEvent(new MouseEvent('pointerenter'))
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  expect(svg).toBeInTheDocument()
})
