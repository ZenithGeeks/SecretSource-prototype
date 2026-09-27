/**
 * The Author role's shell: its nav is Home, Library, Graph and History — no Find a source —
 * and its Graph and History screens are the Researcher's components (Graph directly, History
 * through useHistoryWorkspace), not copies. Against the fake gateway, with login off.
 */

import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { AuthorApp } from '../src/roles/author/AuthorApp'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
// The Researcher's screens, stubbed so the test can tell the shared components from forks.
vi.mock('../src/roles/researcher/screens/History', () => ({
  History: (props: { selected: string | null }) => <div data-testid="researcher-history">researcher history · selected={String(props.selected)}</div>,
}))
vi.mock('../src/roles/researcher/screens/Graph', () => ({
  Graph: (props: { onOpenAnalysis: (id: string) => void }) => (
    <div data-testid="researcher-graph">
      researcher graph
      <button type="button" onClick={() => props.onOpenAnalysis('a7')}>
        open paper a7
      </button>
    </div>
  ),
}))

let gateway: FakeGateway

function renderApp(search = '') {
  window.history.replaceState(null, '', search || window.location.pathname)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onChangeRole = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <AuthorApp onChangeRole={onChangeRole} />
    </QueryClientProvider>,
  )
  return { onChangeRole }
}

/** The sidebar nav — screens have their own buttons too. */
function nav() {
  return within(screen.getAllByRole('navigation')[0])
}

function navLabels(): string[] {
  return nav()
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '')
}

// CodeMirror measures text with Range geometry that jsdom does not implement.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList
  Element.prototype.scrollIntoView = () => undefined
})

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', window.location.pathname)
})

describe('AuthorApp', () => {
  test('the nav is exactly Home, Library, Graph, History — no Find a source', async () => {
    renderApp()
    await screen.findAllByRole('navigation')
    expect(navLabels()).toEqual(['Home', 'Library', 'Graph', 'History'])
    expect(nav().queryByRole('button', { name: 'Find a source' })).toBeNull()
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  test('each tab opens its screen and the URL follows', async () => {
    renderApp()
    await screen.findAllByRole('navigation')
    fireEvent.click(nav().getByRole('button', { name: 'Library' }))
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('library')
    expect(await screen.findByRole('button', { name: /Unsorted sources/ })).toBeInTheDocument()

    fireEvent.click(nav().getByRole('button', { name: 'Graph' }))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('graph')
    expect(screen.getByTestId('researcher-graph')).toBeInTheDocument()

    fireEvent.click(nav().getByRole('button', { name: 'History' }))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('history')
    expect(screen.getByTestId('researcher-history')).toBeInTheDocument()
  })

  test('Graph is the Researcher Graph component; a paper picked on it opens on History', async () => {
    renderApp('?screen=graph')
    expect(await screen.findByTestId('researcher-graph')).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: 'open paper a7' }))
    expect(await screen.findByTestId('researcher-history')).toHaveTextContent('selected=a7')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('history')
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('a7')
  })

  test('an edit refused on the way out of the editor is reported on the screen the author lands on', async () => {
    renderApp('?screen=editor&draft=d1&file=related-work.tex')
    const source = await screen.findByLabelText('related-work.tex source')
    await waitFor(() => expect(source.textContent).toContain('\\section{Related work}'))

    gateway.failWrites = true
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 0, insert: '% leaving\n' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Check a draft' }))

    expect(await screen.findByRole('heading', { name: 'Check a draft' })).toBeInTheDocument()
    expect(await screen.findByText('Your last edits to related-work.tex were not saved: the gateway is down')).toBeInTheDocument()
    expect(gateway.drafts.get('d1')!.files.find((f) => f.name === 'related-work.tex')!.content.startsWith('% leaving')).toBe(false)
  })

  test('a bookmarked ?screen=find-source (the removed tab) lands on Home', async () => {
    renderApp('?screen=find-source&q=late+interaction')
    await screen.findAllByRole('navigation')
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('home')
    expect(new URLSearchParams(window.location.search).get('q')).toBeNull()
  })

  test('History renders the Researcher History component, with ?analysis= as the open one', async () => {
    renderApp('?screen=history&analysis=a42')
    expect(await screen.findByTestId('researcher-history')).toHaveTextContent('selected=a42')
    expect(nav().getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    // the shared sidebar list is there too, fed by the same /analyses the Researcher reads
    expect(await screen.findByText('No analyses yet.')).toBeInTheDocument()
    expect(gateway.calls).toContain('GET /analyses')
  })
})
