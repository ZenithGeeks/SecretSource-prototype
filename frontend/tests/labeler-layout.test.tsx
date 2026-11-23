/** The labeler workspace gives the claim panel its room back (SCRUM-405): the claim strip shares
 * the header row, the shortcut list can be put away and stays away, and the width of
 * the claim panel is the person's to change. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Home } from 'lucide-react'
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
import { AppShell } from '../src/components/AppShell'

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

  it('keeps an unfinished claim when the header moves across 1280px', async () => {
    let width = 1100
    const listeners = new Set<() => void>()
    window.matchMedia = vi.fn((query: string) => ({
      get matches() { return width >= Number(query.match(/\d+/)?.[0]) },
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }) as unknown as MediaQueryList)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell nav={[{ key: 'home', label: 'Home', icon: Home }]} active="home" onNavigate={() => {}} role="Labeler" roleIcon={Home} breadcrumb={['Papers', 'Paper A']} wide="full">
          <Workspace analysisId="a1" />
        </AppShell>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add a missed claim' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'A claim extraction missed' }), { target: { value: 'A new claim' } })
    const resize = (next: number) => act(() => { width = next; listeners.forEach((listener) => listener()) })
    resize(1300)
    expect(screen.getByRole('textbox', { name: 'A claim extraction missed' })).toHaveValue('A new claim')
    expect(screen.getByRole('navigation', { name: 'Claims of this paper' }).closest('main')).toBeNull()
    resize(1100)
    expect(screen.getByRole('textbox', { name: 'A claim extraction missed' })).toHaveValue('A new claim')
    expect(screen.getByRole('navigation', { name: 'Claims of this paper' }).closest('main')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add claim' }))
    expect(screen.getByRole('button', { name: 'Claim 3, in progress, unsaved: A new claim' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))
    expect(screen.getByRole('textbox', { name: 'A claim extraction missed' })).toHaveValue('')
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

  it('keeps the current claim on F when only it is undecided or all claims are finished', async () => {
    session.saved = {
      claims: [{ claim_id: 'paperA#0', status: 'rejected' }],
      candidates: [],
      labels: [],
    } as unknown as typeof session.saved
    const { unmount } = renderWorkspace()
    await screen.findByRole('heading', { name: 'Claim 1 of 2' })
    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.getByRole('heading', { name: 'Claim 2 of 2' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.getByRole('heading', { name: 'Claim 2 of 2' })).toBeInTheDocument()
    unmount()

    session.saved = {
      claims: [
        { claim_id: 'paperA#0', status: 'rejected' },
        { claim_id: 'paperA#1', status: 'rejected' },
      ],
      candidates: [],
      labels: [],
    } as unknown as typeof session.saved
    renderWorkspace()
    await screen.findByRole('heading', { name: 'Claim 1 of 2' })
    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.getByRole('heading', { name: 'Claim 1 of 2' })).toBeInTheDocument()
    session.saved = { claims: [], candidates: [], labels: [] }
  })
})
