/**
 * The Author role's shell: its nav is Home, Library, Graph and History — no Find a source —
 * and its Graph and History screens are the Researcher's components (Graph directly, History
 * through useHistoryWorkspace), not copies. Against the fake gateway, with login off.
 */

import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { runTool } from '../src/lib/agentTools'
import { clearDoItConversation } from '../src/lib/doItConversation'
import { AuthorApp } from '../src/roles/author/AuthorApp'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Ask's Do it streams: each POST gets the next list of agent events.
const agent = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  streams: [] as object[][],
}))
vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  postEvents: vi.fn(async (path: string, body: Record<string, unknown>, onEvent: (event: object) => void) => {
    agent.posts.push({ path, body })
    for (const event of agent.streams.shift() ?? []) onEvent(event)
  }),
}))
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
  const onSwitchRole = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <AuthorApp onChangeRole={onChangeRole} onSwitchRole={onSwitchRole} />
    </QueryClientProvider>,
  )
  return { onChangeRole, onSwitchRole }
}

/** Opens the toolbar's Ask on its Do it mode and sends `message` to the agent. */
function doIt(message: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
  fireEvent.click(within(screen.getByRole('group', { name: 'What Ask does' })).getByRole('button', { name: 'Do it' }))
  const field = screen.getByRole('textbox', { name: 'What should the AI do?' })
  fireEvent.change(field, { target: { value: message } })
  fireEvent.submit(field.closest('form') as HTMLFormElement)
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
  agent.posts = []
  agent.streams = []
  clearDoItConversation() // a switch carries the Do it conversation outside React
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

  test('Ask has Do it, and Do it asks the Author’s screen agent about the screen showing', async () => {
    renderApp('?screen=library')
    await screen.findAllByRole('navigation')
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
    const modes = screen.getByRole('group', { name: 'What Ask does' })
    expect(within(modes).getAllByRole('button').map((button) => button.textContent)).toEqual(['Answer', 'Do it'])
    // Do it offers the Author's own examples, not the Researcher's papers.
    fireEvent.click(within(modes).getByRole('button', { name: 'Do it' }))
    expect(screen.getByRole('button', { name: 'What drafts do I have?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Which citations in my latest draft aren’t supported?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open my most recent paper' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: true }))

    doIt('What drafts do I have?')
    await waitFor(() =>
      expect(agent.posts[0]).toEqual({ path: '/agent/runs', body: { message: 'What drafts do I have?', screen: 'library', role: 'writer' } }),
    )
  })

  test('the agent opens an Author screen, and moves to another role only after Switch', async () => {
    agent.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'open_screen', args: { screen: 'history' } }],
      [{ type: 'tool', id: 'c2', name: 'switch_role', args: { role: 'researcher', reason: 'Analyses are in the Researcher role' } }],
      [{ type: 'say', text: 'You are in the Researcher role now.' }, { type: 'done' }],
    ]
    const { onSwitchRole } = renderApp('?screen=library')
    await screen.findAllByRole('navigation')
    doIt('Open my analyses')

    const approve = await screen.findByRole('group', { name: 'Approve this change' })
    expect(nav().getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    expect(agent.posts[1].body).toEqual({ id: 'c1', name: 'open_screen', result: { status: 'done', screen: 'history' }, role: 'writer' })
    expect(approve).toHaveTextContent('Switch to the Researcher role. Analyses are in the Researcher role')
    expect(within(approve).getByRole('button', { name: 'Switch' })).toBeInTheDocument()
    expect(onSwitchRole).not.toHaveBeenCalled()

    fireEvent.click(within(approve).getByRole('button', { name: 'Switch' }))
    // The result goes to the Author's agent, which has its last word, and only then does the
    // app move to the Researcher role, carrying the conversation.
    await waitFor(() => expect(onSwitchRole).toHaveBeenCalledWith('researcher'))
    expect(agent.posts[2]).toEqual({
      path: '/agent/runs/s1/results',
      body: { id: 'c2', name: 'switch_role', result: { status: 'switched' }, role: 'writer' },
    })
    expect(screen.getByText('You are in the Researcher role now.')).toBeInTheDocument()
    expect(agent.streams).toHaveLength(0)
  })

  test('read_screen sees the drafts, citations, projects and buttons on Home, the Library and a project', async () => {
    gateway = installFakeGateway({ files: THESIS_FILES, prechecked: true })
    // jsdom has no layout, so give every element a box the way a browser would.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const read = async () => {
      const actions = { screen: 'any', screens: [], openScreen: vi.fn(), openPaper: vi.fn() }
      const result = await runTool({ id: '1', name: 'read_screen', args: {} }, { actions, point: vi.fn(), confirm: vi.fn() })
      return result.targets as { target: string; label: string }[]
    }
    const targets = async () => (await read()).map((t) => t.target)

    renderApp('?screen=home&draft=d1')
    await screen.findByRole('list', { name: 'Drafts' })
    fireEvent.click(await screen.findByRole('button', { name: 'All' }))
    await waitFor(async () => expect((await targets()).some((t) => t.startsWith('citation:'))).toBe(true))
    expect(await targets()).toEqual(
      expect.arrayContaining(['screen:home', 'action:check', 'action:upload', 'action:write-draft', 'action:add-bibliography', 'draft:d1', 'draft:d2', 'action:new-draft']),
    )
    expect((await read()).find((t) => t.target === 'draft:d2')?.label).toContain('Seminar paper (CPE)')

    fireEvent.click(nav().getByRole('button', { name: 'Library' }))
    await screen.findByRole('button', { name: /Unsorted sources/ })
    await waitFor(async () =>
      expect(await targets()).toEqual(expect.arrayContaining(['project:proj1', 'project:unsorted', 'action:import-bib', 'action:new-project'])),
    )

    fireEvent.click((await screen.findAllByRole('button', { name: /Related work — thesis ch.2/ }))[0])
    await waitFor(async () =>
      expect(await targets()).toEqual(expect.arrayContaining(['action:back-to-library', 'action:new-draft', 'draft:d1', 'draft:d2', 'action:open-draft'])),
    )
    vi.restoreAllMocks()
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
