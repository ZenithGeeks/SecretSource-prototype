/** The labeler workspace gives the claim panel its room back (SCRUM-405): the claim strip shares
 * the header row, the shortcut list and Ask AI can be put away and stay away, and the width of
 * the claim panel is the person's to change. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('shows the shortcuts until they are put away, and keeps them away after a reload', async () => {
    const { unmount } = renderWorkspace()
    expect(await screen.findByRole('list', { name: SHORTCUTS })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '?' })
    expect(screen.queryByRole('list', { name: SHORTCUTS })).not.toBeInTheDocument()

    unmount()
    renderWorkspace()
    const button = await screen.findByRole('button', { name: SHORTCUTS })
    expect(screen.queryByRole('list', { name: SHORTCUTS })).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(screen.getByRole('list', { name: SHORTCUTS })).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not take a question mark typed in a text box for the shortcut', async () => {
    renderWorkspace()
    await screen.findByRole('list', { name: SHORTCUTS })
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))

    fireEvent.keyDown(screen.getByRole('textbox'), { key: '?' })

    expect(screen.getByRole('list', { name: SHORTCUTS })).toBeInTheDocument()
  })

  it('gives the keyboard back to the add button when the new-claim form closes', async () => {
    renderWorkspace()
    const add = await screen.findByRole('button', { name: 'Add a missed claim' })
    fireEvent.click(add)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(add).toHaveFocus()
  })

  it('opens and closes Ask AI from the header', async () => {
    renderWorkspace()
    const ask = await screen.findByRole('button', { name: 'Ask AI' })
    expect(ask.closest('header')).not.toBeNull()
    expect(ask).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(ask)
    expect(await screen.findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument()
    expect(ask).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask AI' })).not.toBeInTheDocument())
    expect(ask).toHaveAttribute('aria-expanded', 'false')
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
})
