/** The workspace keeps its notices, sidebar, headings and help where a labeler expects them:
 * undo always says what it did, the sidebar comes back after Side by side, and every Tab stop
 * has a name. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
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

// Neither claim cites refB, so both have no reference to read.
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

import { AppShell } from '../src/components/AppShell'
import { Workspace } from '../src/roles/labeler/screens/Workspace'

function renderInShell() {
  const client = new QueryClient()
  const tree = (
    <QueryClientProvider client={client}>
      <AppShell nav={[{ key: 'home', label: 'Home', icon: Home }]} active="home" onNavigate={() => {}} role="Labeler" roleIcon={Home} foldable>
        <Workspace analysisId="a1" />
      </AppShell>
    </QueryClientProvider>
  )
  const empty = (
    <QueryClientProvider client={client}>
      <AppShell nav={[{ key: 'home', label: 'Home', icon: Home }]} active="home" onNavigate={() => {}} role="Labeler" roleIcon={Home} foldable>
        <p>Papers</p>
      </AppShell>
    </QueryClientProvider>
  )
  const view = render(tree)
  return { ...view, leave: () => view.rerender(empty) }
}

const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' })

describe('the workspace and the sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('opens the sidebar again when Side by side is left', async () => {
    window.localStorage.setItem('labeler.paperView', 'side')
    renderInShell()
    await screen.findByRole('navigation', { name: 'Claims of this paper' })
    expect(sidebar()).toHaveAttribute('data-folded')
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }))
    expect(sidebar()).not.toHaveAttribute('data-folded')
  })

  it('opens the sidebar again when the workspace closes', async () => {
    window.localStorage.setItem('labeler.paperView', 'side')
    const { leave } = renderInShell()
    await screen.findByRole('navigation', { name: 'Claims of this paper' })
    expect(sidebar()).toHaveAttribute('data-folded')
    leave()
    expect(sidebar()).not.toHaveAttribute('data-folded')
  })

  it('leaves a sidebar folded before Side by side folded after it', async () => {
    window.localStorage.setItem('labeler.paperView', 'side')
    window.localStorage.setItem('shell.sidebarFolded', '1')
    renderInShell()
    await screen.findByRole('navigation', { name: 'Claims of this paper' })
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }))
    expect(sidebar()).toHaveAttribute('data-folded')
  })

  it('keeps the choice of a labeler who folded the sidebar again by hand', async () => {
    window.localStorage.setItem('labeler.paperView', 'side')
    renderInShell()
    await screen.findByRole('navigation', { name: 'Claims of this paper' })
    fireEvent.click(screen.getByRole('button', { name: 'Open the sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fold the sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }))
    expect(sidebar()).toHaveAttribute('data-folded')
  })
})

function renderWorkspace() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Workspace analysisId="a1" />
    </QueryClientProvider>,
  )
}

describe('the workspace help and notices', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('shows "Nothing to undo" afresh each time Z finds nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderWorkspace()
      await screen.findByRole('heading', { name: 'Claim 1 of 2' })
      fireEvent.keyDown(window, { key: 'k' })
      fireEvent.keyDown(window, { key: 'z' })
      expect(screen.getByText('Undone: Keep')).toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'z' })
      const first = screen.getByText('Nothing to undo on this claim')
      act(() => vi.advanceTimersByTime(3000))
      fireEvent.keyDown(window, { key: 'z' })
      const second = screen.getByText('Nothing to undo on this claim')
      // A new node, so a screen reader reads it again, and a new four seconds.
      expect(second).not.toBe(first)
      act(() => vi.advanceTimersByTime(3000))
      expect(screen.getByText('Nothing to undo on this claim')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1500))
      expect(screen.queryByText('Nothing to undo on this claim')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the heading above the claim once it is decided', async () => {
    renderWorkspace()
    await screen.findByRole('heading', { name: 'Claim 1 of 2' })
    fireEvent.keyDown(window, { key: 'k' })
    const heading = screen.getByRole('heading', { name: 'Claim 1 of 2' })
    const text = screen.getByText('Method Y improves recall.')
    expect(heading.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the shortcut list over the papers, never over the label panel', async () => {
    renderWorkspace()
    const button = await screen.findByRole('button', { name: 'Keyboard shortcuts' })
    fireEvent.click(button)
    const list = screen.getByRole('region', { name: 'Keyboard shortcuts' })
    expect(screen.getByRole('region', { name: 'Paper and reference' })).toContainElement(list)
    expect(screen.getByRole('region', { name: 'Label this claim' })).not.toContainElement(list)
    expect(within(list).getByRole('button', { name: 'Labeling guide' })).toBeInTheDocument()
  })

  it('opens the shortcut list under its button on a narrow screen', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    renderWorkspace()
    const button = await screen.findByRole('button', { name: 'Keyboard shortcuts' })
    fireEvent.click(button)
    expect(button.parentElement).toContainElement(screen.getByRole('region', { name: 'Keyboard shortcuts' }))
  })

  it('goes to the next unfinished claim from its own button, and shows the count as text', async () => {
    renderWorkspace()
    await screen.findByRole('heading', { name: 'Claim 1 of 2' })
    expect(screen.queryByRole('button', { name: /claims finished/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next unfinished' }))
    expect(screen.getByRole('heading', { name: 'Claim 2 of 2' })).toBeInTheDocument()
  })

  it.each([
    [[], 'No passages: this claim cites no paper.'],
    [['b1'], 'No passages: no reference to read (1 cited work).'],
    [['b1', 'b2'], 'No passages: no reference to read (2 cited works).'],
  ])('says in one line why a claim citing %j has no passages', async (refs, line) => {
    const claim = session.claims[0] as (typeof session.claims)[0] & { unchecked?: unknown[] }
    claim.unchecked = refs.map((ref) => ({ ref, label: `Work ${ref}`, reason: 'no-open-access' }))
    try {
      renderWorkspace()
      await screen.findByRole('heading', { name: 'Claim 1 of 2' })
      fireEvent.keyDown(window, { key: 'k' })
      expect(await screen.findByText(line)).toBeInTheDocument()
      // A claim that cites no paper has nowhere a missed passage could come from. One that cites
      // works with no PDF can only take one pasted in, and the button says so.
      expect(screen.queryByRole('button', { name: 'Paste a passage from a cited work' }) !== null).toBe(refs.length > 0)
      expect(screen.queryByRole('button', { name: 'Add a missed passage' })).not.toBeInTheDocument()
    } finally {
      delete claim.unchecked
    }
  })

  it('names every Tab stop after the decision on a claim with no reference', async () => {
    const { container } = renderWorkspace()
    const tabStops = () =>
      [...container.querySelectorAll<HTMLElement>('a[href], button, select, textarea, input, summary, [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
      )
    const keep = await screen.findByRole('radio', { name: /Keep/ })
    for (const stop of tabStops().slice(tabStops().indexOf(keep) + 1)) expect(computeAccessibleName(stop)).not.toBe('')

    fireEvent.keyDown(window, { key: 'k' })
    const chosen = screen.getByRole('button', { name: /Keep/ })
    const after = tabStops().slice(tabStops().indexOf(chosen) + 1)
    expect(after.length).toBeGreaterThan(0)
    for (const stop of after) expect(computeAccessibleName(stop)).not.toBe('')
  })
})
