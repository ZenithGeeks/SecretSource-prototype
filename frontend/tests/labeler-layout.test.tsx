/** The labeler workspace gives the claim panel its room back (SCRUM-405): the claim strip shares
 * the header row, the shortcut list can be put away and stays away, and the width of
 * the claim panel is the person's to change. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string) => {
    if (path.startsWith('/labeling/sessions/')) return session
    throw new Error(`unexpected ${path}`)
  }),
  postEvents: vi.fn(),
  fetchFile: vi.fn(),
  api: { findInPaper: vi.fn(async () => ({ page: null, boxes: [] })) },
}))
vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => null }))

const session = {
  analysis_id: 'a1',
  paper_id: 'paperA',
  paper_file: 'paperA.pdf',
  title: 'Paper A',
  annotator: 'chanya',
  claims: ['Method Y improves recall.', 'Method Z is faster.'].map((claim, i) => ({
    claim_id: `paperA#${i}`,
    claim,
    sentence: claim,
    section: '3',
    source: null,
    candidates: [],
  })),
  references: [{ reference_id: 'refB', file: 'refB.pdf', label: 'Ref B', ref: 'b4', authors: [], year: '2021' }],
  saved: { claims: [], candidates: [], labels: [] },
  others: {},
}

import { Workspace } from '../src/roles/labeler/screens/Workspace'

const SHORTCUTS = 'Keyboard shortcuts'

function renderWorkspace() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Workspace analysisId="a1" />
    </QueryClientProvider>,
  )
}

describe('the labeler workspace layout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('keeps the claim strip in the header row, not on a row of its own', async () => {
    renderWorkspace()
    const strip = await screen.findByRole('navigation', { name: 'Claims of this paper' })
    expect(strip.closest('header')).not.toBeNull()
  })

  it('shows the shortcuts only when ? or the button is pressed', async () => {
    renderWorkspace()
    const button = await screen.findByRole('button', { name: SHORTCUTS })
    expect(screen.queryByRole('list', { name: SHORTCUTS })).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getByRole('list', { name: SHORTCUTS })).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(window, { key: '?' })
    expect(screen.queryByRole('list', { name: SHORTCUTS })).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.getByRole('list', { name: SHORTCUTS })).toBeInTheDocument()
  })

  it('does not take a question mark typed in a text box for the shortcut', async () => {
    renderWorkspace()
    await screen.findByRole('button', { name: SHORTCUTS })
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))

    fireEvent.keyDown(screen.getByRole('textbox'), { key: '?' })

    expect(screen.queryByRole('list', { name: SHORTCUTS })).not.toBeInTheDocument()
  })

  it('gives the keyboard back to the add button when the new-claim form closes', async () => {
    renderWorkspace()
    const add = await screen.findByRole('button', { name: 'Add a missed claim' })
    fireEvent.click(add)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(add).toHaveFocus()
  })

  it('keeps the width the person gave the claim panel after a reload', async () => {
    const { unmount } = renderWorkspace()
    const handle = await screen.findByRole('separator', { name: 'Resize the papers and the label panel' })
    expect(handle).toHaveAttribute('aria-valuenow', '70')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '65')

    unmount()
    renderWorkspace()
    expect(await screen.findByRole('separator', { name: 'Resize the papers and the label panel' })).toHaveAttribute(
      'aria-valuenow',
      '65',
    )
  })

  it('resizes the stacked viewers with a vertical split and remembers it across reload', async () => {
    const { unmount } = renderWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'Stacked' }))
    const handle = screen.getByRole('separator', { name: 'Resize the reference and the paper under review' })
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuenow', '60')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle).toHaveAttribute('aria-valuenow', '55')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(handle).toHaveAttribute('aria-valuenow', '60')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle).toHaveAttribute('aria-valuenow', '55')

    unmount()
    renderWorkspace()
    const reloaded = await screen.findByRole('separator', { name: 'Resize the reference and the paper under review' })
    expect(reloaded).toHaveAttribute('aria-valuenow', '55')

    reloaded.setPointerCapture = vi.fn()
    fireEvent.pointerDown(reloaded, { pointerId: 1, clientY: 50 })
    fireEvent.pointerMove(reloaded, { clientY: 60 })
    fireEvent.pointerUp(reloaded)
  })

  it('jumps to the next unfinished claim on F and resets scroll on claim change', async () => {
    renderWorkspace()
    await screen.findByRole('heading', { name: 'Claim 1 of 2' })
    const scroller = document.querySelector('.overflow-y-auto.p-4') as HTMLElement
    scroller.scrollTop = 200

    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.getByRole('heading', { name: 'Claim 2 of 2' })).toBeInTheDocument()
    expect(scroller.scrollTop).toBe(0)

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.getByRole('heading', { name: 'Claim 1 of 2' })).toBeInTheDocument()
  })
})
