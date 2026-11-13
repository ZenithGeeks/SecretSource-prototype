/**
 * The Author role's shell (Redesign R/Sidebar, Role=Author): its nav is Home and Library — no
 * Projects, Find a source, Graph or History (#712) — with Recent projects under it (#718).
 * Against the fake gateway, with login off.
 */

import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { runTool } from '../src/lib/agentTools'
import { clearDoItConversation } from '../src/lib/doItConversation'
import { AuthorApp } from '../src/roles/author/AuthorApp'
import { Toaster } from '../src/components/Toaster'
import { installFakeGateway, runCheck, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Sonner keeps its toasts in a module-level store, and the next test's Toaster would show the
// ones still up: dismiss them so each test starts with none. Only the files that mount a
// Toaster do this, since importing sonner adds its stylesheet to the page and slows queries.
afterEach(() => toast.dismiss())

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
      <Toaster />
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
    // The redesign's type scope, shared with the Researcher (#713).
    expect(document.querySelector('.redesign-app')).not.toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))

    expect(await screen.findByRole('heading', { level: 1, name: /^Good/ })).toBeInTheDocument()
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

  test('open_paper in the Author role fails instead of switching roles without approval', async () => {
    agent.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'open_paper', args: { analysis_id: 'a7' } }],
      [{ type: 'done' }],
    ]
    const { onSwitchRole } = renderApp('?screen=home&draft=d1')
    await screen.findAllByRole('navigation')
    doIt('Open paper a7')

    await waitFor(() => expect(agent.posts).toHaveLength(2))
    expect(agent.posts[1].body).toMatchObject({ id: 'c1', name: 'open_paper', result: { status: 'error' } })
    expect(onSwitchRole).not.toHaveBeenCalled()
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
    expect(await targets()).toEqual(expect.arrayContaining(['screen:home', 'action:check', 'action:open-editor', 'action:new-project', 'draft:d1', 'draft:d2', 'action:new-draft']))
    // Uploading and the rest are in the New project menu: listed while it is open.
    expect(await targets()).not.toContain('action:upload')
    fireEvent.click(screen.getByRole('button', { name: 'New project', expanded: false }))
    expect(await targets()).toEqual(expect.arrayContaining(['action:upload', 'action:write-draft', 'action:add-bibliography']))
    fireEvent.click(screen.getByRole('button', { name: 'New project', expanded: true }))
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
    // The bare editor keeps the redesign's type scope too (#713).
    expect(screen.getByLabelText('related-work.tex source').closest('.redesign-app')).not.toBeNull()
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
    expect(await screen.findByRole('heading', { level: 1, name: /^Good/ })).toBeInTheDocument()
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

  test.each(['check', 'draft-check', 'check-draft', 'draftcheck'])('an old link to the Check a draft screen (?screen=%s) redirects to Home, keeping its draft', async (old) => {
    renderApp(`?screen=${old}&draft=d1`)
    expect(await screen.findByRole('heading', { level: 1, name: /^Good/ })).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    const params = new URLSearchParams(window.location.search)
    expect(params.get('screen')).toBe('home')
    expect(params.get('draft')).toBe('d1')
    expect(gateway.calls).toContain('GET /author/drafts/d1')
  })

  test('a toast set as Home moves to the new draft is still there after the move', async () => {
    renderApp('?screen=home&draft=d1')
    await screen.findByRole('list', { name: 'Drafts' })
    fireEvent.change(screen.getByLabelText('Upload a .tex or .zip file'), { target: { files: [new File(['\\section{A}'], 'chapter.tex')] } })
    expect(await screen.findByText(/chapter\.tex uploaded/)).toBeInTheDocument()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('draft')).toMatch(/^draft/))
    expect(screen.getByText(/chapter\.tex uploaded/)).toBeInTheDocument()
  })

  test('New project ▾ is in the toolbar on Home only, with the actions that start a draft or project', async () => {
    renderApp('?screen=home&draft=d1')
    await screen.findByRole('list', { name: 'Drafts' })
    const button = screen.getByRole('button', { name: 'New project', expanded: false })
    expect(button).toHaveAttribute('data-ask-target', 'action:new-project')
    fireEvent.click(button)
    const menu = within(screen.getByRole('menu'))
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['New project', 'Upload .tex or .zip', 'Write a draft', 'Add bibliography'])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New project', expanded: false }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Write a draft' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('screen')).toBe('editor'))
    expect(gateway.calls).toContain('POST /author/drafts')
  })

  test.each([
    ['New project ▾', () => {
      fireEvent.click(screen.getByRole('button', { name: 'New project', expanded: false }))
      fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'New project' }))
    }],
    ['Recent projects "+ New"', () => {
      fireEvent.click(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('button', { name: 'New project' }))
    }],
  ])('%s opens the New project dialog, and the project opens once created', async (_name, open) => {
    renderApp('?screen=home&draft=d1')
    await screen.findByRole('list', { name: 'Drafts' })
    open()
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    expect(gateway.calls).not.toContain('POST /author/projects')
    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Grant aims' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('heading', { name: 'Grant aims' })).toBeInTheDocument()
    expect(gateway.calls).toContain('POST /author/projects')
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  })

  test('the dialog\'s Import takes a .bib, says so, and opens the project', async () => {
    renderApp('?screen=home&draft=d1')
    await screen.findByRole('list', { name: 'Drafts' })
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('button', { name: 'New project' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'New project' })).getByRole('button', { name: /Import a \.bib/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New project' })).toBeNull())
    fireEvent.change(screen.getByLabelText('Import a .bib or an Overleaf .zip'), { target: { files: [new File(['@misc{a,title={A}}'], 'refs.bib')] } })
    await waitFor(() => expect(gateway.calls).toContain('POST /author/projects/import'))
    expect(await screen.findByText(/created from refs\.bib/)).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
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

  test.each([
    ['supports', /some citations not checked yet/],
    ['unavailable', /some citations could not be checked/],
  ] as const)('a project with one draft checked (%s) and one never checked says which', async (verdict, label) => {
    gateway = installFakeGateway({
      files: [{ name: 'a.tex', content: 'One~\\cite{k2020}.' }, { name: 'refs.bib', content: '@misc{k2020, title={K}, url={https://a.b}}' }],
      prechecked: false,
      verdictFor: () => (verdict === 'supports' ? { verdict, passage: 'all good', page: 1 } : { verdict, reason: 'no-open-access', message: 'no free copy' }),
    })
    gateway.drafts.get('d2')!.files = [{ name: 'b.tex', kind: 'tex', content: 'Two~\\cite{k2020}.' }]
    runCheck(gateway, 'd1')
    renderApp()
    await waitFor(() => expect(recentNames()).toHaveLength(1))
    expect(recent().getByRole('button', { name: /^Related work — thesis ch.2/ })).toHaveAccessibleName(label)
  })

  test('"+ New" asks for a name, makes the project, opens it, and the list shows it', async () => {
    renderApp()
    await waitFor(() => expect(recentNames()).toHaveLength(1))
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('button', { name: 'New project' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'New project' })).getByRole('button', { name: 'Create project' }))
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

describe('The editor goes back where it was opened from (#721)', () => {
  /** Waits for the editor to show the draft's source. */
  async function editorOpen() {
    await waitFor(() => expect(screen.getByLabelText(/ source$/).textContent).toContain('\\documentclass'))
  }
  const crumbs = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
  /** A reload: the app is mounted again from the URL as it stands. */
  function reload() {
    const search = window.location.search
    cleanup()
    renderApp(search)
  }

  beforeEach(() => {
    gateway.projects.get('proj1')!.name = 'Thesis'
  })

  test('from Home: Back and the Home crumb go to Home; the project crumb opens the project', async () => {
    renderApp('?screen=home&draft=d1')
    fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' }))
    await editorOpen()
    expect(new URLSearchParams(window.location.search).get('from')).toBeNull()
    expect(await crumbs().findByRole('button', { name: 'Thesis' })).toBeInTheDocument()
    expect(crumbs().getByRole('button', { name: /^Draft title: Related work — thesis ch\.2/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
    expect(await screen.findByRole('heading', { level: 1, name: /^Good/ })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' }))
    await editorOpen()
    fireEvent.click(await crumbs().findByRole('button', { name: 'Thesis' }))
    expect(await screen.findByRole('heading', { name: 'Thesis' })).toBeInTheDocument()
  })

  test('from a project page: Back returns to it, also after a reload of the editor', async () => {
    renderApp('?screen=library&project=proj1')
    fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' }))
    await editorOpen()
    const params = new URLSearchParams(window.location.search)
    expect([params.get('screen'), params.get('from'), params.get('project')]).toEqual(['editor', 'library', 'proj1'])

    reload()
    await editorOpen()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Thesis' }))
    expect(await screen.findByRole('heading', { name: 'Thesis' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('from')).toBeNull()
  })

  test('from the Library itself, after a reload: Back goes to the Library, not a project', async () => {
    renderApp('?screen=editor&draft=d1&from=library')
    await editorOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
  })

  test('an Unsorted draft has no project crumb, and Back returns to Unsorted', async () => {
    cleanup()
    gateway = installFakeGateway({ files: THESIS_FILES, project: false })
    renderApp('?screen=library&project=unsorted')
    fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' }))
    await editorOpen()
    expect(crumbs().getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Related work — thesis ch.2'])
    fireEvent.click(screen.getByRole('button', { name: 'Back to Unsorted' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('project')).toBe('unsorted'))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('library')
  })

  test('an issue’s "Ask AI how to fix" opens Ask on Do it with the citation and its issue typed in, not sent', async () => {
    renderApp('?screen=editor&draft=d1&file=related-work.tex')
    await editorOpen()
    const page = () => screen.getByTestId('preview-page').shadowRoot!
    await waitFor(() => expect(page().querySelector('.ss-cite[data-verdict="refutes"]')).toBeTruthy(), { timeout: 15000 })
    fireEvent.click(page().querySelector('.ss-cite[data-verdict="refutes"]')!)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask AI how to fix' }))

    expect(screen.queryByRole('dialog', { name: /Khattab/ })).toBeNull()
    const field = await screen.findByRole('textbox', { name: 'What should the AI do?' })
    expect((field as HTMLInputElement).value).toMatch(/^How do I fix \\cite\{khattab2020\} in related-work\.tex, line \d+: source contradicts/)
    expect(field).toHaveFocus()
    expect(agent.posts).toHaveLength(0)

    // A second issue while Do it is open replaces the request with its own.
    fireEvent.click(page().querySelector('.ss-cite[data-verdict="insufficient"]')!)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask AI how to fix' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'What should the AI do?' }) as HTMLInputElement).value).toMatch(/^How do I fix \\cite\{thakur2021\} in related-work\.tex, line \d+: /))

    // Typed in once: leaving Do it and coming back does not put the request back.
    fireEvent.change(field, { target: { value: '' } })
    const modes = within(screen.getByRole('group', { name: 'What Ask does' }))
    fireEvent.click(modes.getByRole('button', { name: 'Answer' }))
    fireEvent.click(modes.getByRole('button', { name: 'Do it' }))
    expect(screen.getByRole('textbox', { name: 'What should the AI do?' })).toHaveValue('')
  }, 20000)
})
