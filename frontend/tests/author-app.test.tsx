/**
 * The Author role's shell (Redesign R/Sidebar, Role=Author): its nav is Home and Library — no
 * Projects, Find a source, Graph or History (#712) — with Recent projects under it (#718).
 * Against the fake gateway, with login off.
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
// The Researcher's screens, stubbed so a test can tell they never render in the Author role.
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
  return { onChangeRole, onSwitchRole, queryClient }
}

/** The desktop sidebar's Recent projects list (the phone menu renders its own copy). */
function recent() {
  return within(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('list', { name: 'Recent projects' }))
}

/** Each row as it reads on screen: the name and its count (not the screen-reader status). */
function recentNames(): string[] {
  return recent()
    .getAllByRole('button')
    .map((row) =>
      [...row.querySelectorAll('span')]
        .filter((span) => span.children.length === 0 && !span.classList.contains('sr-only'))
        .map((span) => span.textContent?.trim())
        .filter(Boolean)
        .join(' '),
    )
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
  test('the nav is exactly Home and Library — no Projects, Find a source, Graph or History', async () => {
    renderApp()
    await screen.findAllByRole('navigation')
    expect(navLabels()).toEqual(['Home', 'Library'])
    for (const gone of ['Projects', 'Find a source', 'Graph', 'History']) expect(nav().queryByRole('button', { name: gone })).toBeNull()
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  test('each tab opens its screen and the URL follows; Library opens the Library, not the last project', async () => {
    renderApp('?screen=library&project=proj1')
    expect(await screen.findByRole('heading', { name: 'Related work — thesis ch.2' })).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(nav().getByRole('button', { name: 'Home' }))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('home')
    fireEvent.click(nav().getByRole('button', { name: 'Library' }))
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('library')
    expect(new URLSearchParams(window.location.search).get('project')).toBeNull()
    expect(await screen.findByRole('button', { name: /Unsorted sources/ })).toBeInTheDocument()
  })

  test.each([
    ['?screen=graph', 'graph'],
    ['?screen=history', 'history'],
    ['?screen=history&analysis=a42', 'an analysis on History'],
    ['?analysis=a42', 'an analysis'],
  ])('a bookmark of %s (%s) opens the Library and says where it went', async (search) => {
    renderApp(search)
    expect(await screen.findByRole('button', { name: /Unsorted sources/ })).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(/History and Graph are in the Researcher role now/)).toBeInTheDocument()
    const params = new URLSearchParams(window.location.search)
    expect(params.get('screen')).toBe('library')
    expect(params.get('analysis')).toBeNull()
    expect(screen.queryByTestId('researcher-graph')).toBeNull()
    expect(screen.queryByTestId('researcher-history')).toBeNull()
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
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'open_screen', args: { screen: 'library' } }],
      [{ type: 'tool', id: 'c2', name: 'switch_role', args: { role: 'researcher', reason: 'Analyses are in the Researcher role' } }],
      [{ type: 'say', text: 'You are in the Researcher role now.' }, { type: 'done' }],
    ]
    const { onSwitchRole } = renderApp('?screen=home&draft=d1')
    await screen.findAllByRole('navigation')
    doIt('Open my analyses')

    const approve = await screen.findByRole('group', { name: 'Approve this change' })
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(agent.posts[1].body).toEqual({ id: 'c1', name: 'open_screen', result: { status: 'done', screen: 'library' }, role: 'writer' })
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

  test('the editor has Ask in its own top bar, and the panel opens beside source and preview, with no sidebar', async () => {
    renderApp('?screen=editor&draft=d1&file=related-work.tex')
    await waitFor(() => expect(screen.getByLabelText('related-work.tex source').textContent).toContain('\\section{Related work}'))
    // Full-bleed: no sidebar and no shell toolbar, only the editor's own top bar.
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open the menu' })).toBeNull()
    const topBar = screen.getByRole('banner')
    // Just "Ask AI" here, not "about your library".
    expect(within(topBar).getByRole('button', { name: 'Ask AI', pressed: false })).toHaveTextContent(/^Ask AI$/)
    fireEvent.click(within(topBar).getByRole('button', { name: 'Ask AI', pressed: false }))
    expect(within(topBar).getByRole('button', { name: 'Ask AI', pressed: true })).toBeInTheDocument()

    const modes = screen.getByRole('group', { name: 'What Ask does' })
    fireEvent.click(within(modes).getByRole('button', { name: 'Do it' }))
    // The editor's own examples, about the draft on screen.
    expect(screen.getByRole('button', { name: 'What do lines 1–20 say?' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Source' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
  })

  test('a Do it run started on Home goes on in the editor, reads the draft there, and comes back', async () => {
    agent.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'open_screen', args: { screen: 'editor' } }],
      [{ type: 'tool', id: 'c2', name: 'read_draft', args: { start_line: 1, end_line: 2 } }],
      [{ type: 'tool', id: 'c3', name: 'open_screen', args: { screen: 'home' } }],
      [{ type: 'say', text: 'Lines 1 and 2 set up the article.' }, { type: 'done' }],
    ]
    renderApp('?screen=home&draft=d1')
    await screen.findByRole('list', { name: 'Drafts' })
    doIt('Open my latest draft in the editor')

    await waitFor(() => expect(agent.posts).toHaveLength(4), { timeout: 5000 })
    expect(agent.posts[1].body).toEqual({ id: 'c1', name: 'open_screen', result: { status: 'done', screen: 'editor' }, role: 'writer' })
    const read = agent.posts[2].body.result as Record<string, unknown>
    expect(read).toMatchObject({ file: 'related-work.tex', first_line: 1, last_line: 2, text: '1\t\\documentclass[11pt]{article}\n2\t\\usepackage{amsmath}' })
    expect(read.bib_keys).toEqual(expect.arrayContaining(['khattab2020']))
    expect(agent.posts[3].body).toEqual({ id: 'c3', name: 'open_screen', result: { status: 'done', screen: 'home' }, role: 'writer' })

    // One conversation the whole way: the panel was never remounted.
    expect(await screen.findByText('Lines 1 and 2 set up the article.')).toBeInTheDocument()
    expect(screen.getByText('Open my latest draft in the editor')).toBeInTheDocument()
    expect(screen.getByText('Reading the draft')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Check a draft' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
  })

  test('the editor is not a screen the agent can open until a draft is selected', async () => {
    agent.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'open_screen', args: { screen: 'editor' } }],
      [{ type: 'say', text: 'Pick a draft first.' }, { type: 'done' }],
    ]
    renderApp('?screen=library')
    await screen.findAllByRole('navigation')
    doIt('Open the editor')
    await waitFor(() => expect(agent.posts).toHaveLength(2))
    expect(agent.posts[1].body.result).toEqual({ status: 'error', message: 'no screen editor; screens: home, library' })
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  })

  test('the agent cannot open Graph or History in the Author role', async () => {
    agent.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'open_screen', args: { screen: 'graph' } }],
      [{ type: 'tool', id: 'c2', name: 'open_screen', args: { screen: 'history' } }],
      [{ type: 'say', text: 'The graph is in the Researcher role.' }, { type: 'done' }],
    ]
    renderApp('?screen=home&draft=d1')
    await screen.findAllByRole('navigation')
    doIt('Show me the graph')
    await waitFor(() => expect(agent.posts).toHaveLength(3))
    expect(agent.posts[1].body.result).toEqual({ status: 'error', message: 'no screen graph; screens: home, library, editor' })
    expect(agent.posts[2].body.result).toEqual({ status: 'error', message: 'no screen history; screens: home, library, editor' })
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  test('a bookmarked ?screen=find-source (the removed tab) lands on Home', async () => {
    renderApp('?screen=find-source&q=late+interaction')
    await screen.findAllByRole('navigation')
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('home')
    expect(new URLSearchParams(window.location.search).get('q')).toBeNull()
  })

})

describe('Recent projects in the sidebar', () => {
  const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

  /** Three projects besides the fixture's proj1, each last touched at a different time. */
  function seedProjects() {
    const base = { bib: null, pdfs: {} }
    gateway.projects.set('pA', { ...base, id: 'pA', name: 'Grant aims', created: t(500), updated: t(300) })
    gateway.projects.set('pB', { ...base, id: 'pB', name: 'ICLR submission', created: t(500), updated: t(5) })
    gateway.projects.set('pC', { ...base, id: 'pC', name: 'Workshop paper', created: t(500), updated: t(900) })
    gateway.projects.get('proj1')!.updated = t(1000)
    // proj1's draft d1 was edited after everything else: the project counts as the most recent.
    gateway.drafts.get('d1')!.edited = t(1)
  }

  test('lists the projects worked on last first, with what needs work and "—" before a check', async () => {
    seedProjects()
    renderApp()
    await waitFor(() => expect(recentNames()).toHaveLength(4))
    expect(recentNames()).toEqual(['Related work — thesis ch.2 3', 'ICLR submission —', 'Grant aims —', 'Workshop paper —'])
    expect(recent().getByRole('button', { name: /^Related work — thesis ch.2/ })).toHaveAccessibleName(/3 need work/)
    expect(recent().getByRole('button', { name: /^Grant aims/ })).toHaveAccessibleName(/not checked yet/)
  })

  test('shows at most five, and a row opens its project and lights up there', async () => {
    seedProjects()
    for (const i of [1, 2, 3]) gateway.projects.set(`old${i}`, { id: `old${i}`, name: `Old ${i}`, bib: null, pdfs: {}, created: t(5000), updated: t(5000 + i) })
    renderApp()
    await waitFor(() => expect(recentNames()).toHaveLength(5))
    expect(recentNames().some((name) => name.startsWith('Old 3'))).toBe(false)

    fireEvent.click(recent().getByRole('button', { name: /^ICLR submission/ }))
    expect(await screen.findByRole('heading', { name: 'ICLR submission' })).toBeInTheDocument()
    expect(recent().getByRole('button', { name: /^ICLR submission/ })).toHaveAttribute('aria-current', 'page')
    expect(recent().getByRole('button', { name: /^Grant aims/ })).not.toHaveAttribute('aria-current')
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(new URLSearchParams(window.location.search).get('project')).toBe('pB')
  })

  test('"+ New" makes a project, opens it, and the list shows it', async () => {
    renderApp()
    await waitFor(() => expect(recentNames()).toHaveLength(1))
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('button', { name: 'New project' }))
    expect(await screen.findByRole('heading', { name: 'Untitled project' })).toBeInTheDocument()
    expect(gateway.calls).toContain('POST /author/projects')
    await waitFor(() => expect(recentNames()[0]).toBe('Untitled project —'))
    expect(recent().getByRole('button', { name: /^Untitled project/ })).toHaveAttribute('aria-current', 'page')
  })

  test('follows a rename and a delete made elsewhere once the library refetches', async () => {
    seedProjects()
    const { queryClient } = renderApp()
    await waitFor(() => expect(recentNames()).toHaveLength(4))
    gateway.projects.get('pB')!.name = 'ICLR camera-ready'
    gateway.projects.delete('pA')
    await act(() => queryClient.invalidateQueries({ queryKey: ['author', 'library'] }))
    await waitFor(() => expect(recentNames()).toEqual(['Related work — thesis ch.2 3', 'ICLR camera-ready —', 'Workshop paper —']))
  })

  test('works from the phone menu: a row opens its project and closes the menu', async () => {
    seedProjects()
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Open the menu' }))
    const menu = within(screen.getByRole('dialog', { name: 'Menu' }))
    expect(menu.getAllByRole('navigation')[0]).toHaveTextContent(/^HomeLibrary$/)
    fireEvent.click(await menu.findByRole('button', { name: /^Workshop paper/ }))
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Workshop paper' })).toBeInTheDocument()
  })
})
