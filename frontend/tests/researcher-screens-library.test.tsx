/** The researcher Library: the project list, creating, renaming and deleting a project, adding
 * analysed papers to one, and the paper table's filters. The gateway is a fetch stub. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'
import { Library } from '../src/roles/researcher/screens/Library'
import { LibraryAddMenu } from '../src/roles/researcher/components/LibraryAddMenu'
import { updatedText } from '../src/lib/researcher'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const NO_TALLY = { backed: 0, silent: 0, contradicted: 0, unchecked: 0 }
const PROJECTS = [
  {
    id: 'p1', name: 'Retrieval survey', papers: 1, claims: 9, clusters: 1,
    tally: { backed: 3, silent: 1, contradicted: 1, unchecked: 4 }, updated: new Date().toISOString(),
  },
  { id: 'p2', name: 'Empty one', papers: 0, claims: 0, clusters: 0, tally: NO_TALLY, updated: '' },
  { id: 'unsorted', name: 'Unsorted', papers: 2, claims: 0, clusters: 0, tally: NO_TALLY, updated: '', unsorted: true },
]

const paper = (over: Record<string, unknown>) => ({
  id: 'a1', title: 'ColBERTv2', cite: 'Santhanam · 2022', cluster: 'Late interaction', claims: 9,
  backed: 6, contradicted: 1, linked: [], sourcesIndexed: 3, sourcesNotIndexed: 0, indexed: 'yes', index: '',
  ...over,
})

const LIBRARY = {
  summary: '3 papers',
  clusters: ['All', 'Unverified', 'Late interaction', 'Tooling'],
  papers: [
    paper({}),
    paper({ id: 'a2', title: 'Tevatron toolkit', cite: 'Gao · 2022', cluster: 'Tooling', claims: 4, backed: null, contradicted: null, linked: ['ColBERTv2', 'PLAID'] }),
    paper({ id: 'a3', title: 'Backed only', cite: 'Lee · 2021', cluster: 'Tooling', claims: 1, backed: 1, contradicted: 0, sourcesNotIndexed: 2 }),
    paper({ id: 'a4', title: 'Silent only', cite: 'Kim · 2020', cluster: 'Tooling', claims: 2, backed: 0, contradicted: null, sourcesNotIndexed: 1, indexed: 'no' }),
  ],
}

const ANALYSES = [
  { id: 'a1', paper: 'colbert.pdf', file: 'colbert.pdf', title: 'ColBERTv2 analysis', status: 'done', claims: [], stages: [] },
  { id: 'a5', paper: 'plaid.pdf', file: 'plaid.pdf', title: 'PLAID', status: 'done', claims: [], stages: [] },
  { id: 'a6', paper: 'raw/new.pdf', file: 'raw/new.pdf', status: 'done', claims: [], stages: [] },
  { id: 'a7', paper: 'p.pdf', status: 'done', claims: [], stages: [] },
  { id: 'a8', paper: 'running.pdf', file: 'running.pdf', title: 'Running one', status: 'running', claims: [], stages: [] },
]

type Call = { method: string; path: string; body: unknown }

function gateway(options: { projects?: unknown; library?: unknown; fail?: string[] } = {}) {
  const calls: Call[] = []
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api/, '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (options.fail?.includes(`${method} ${path}`)) return new Response('boom', { status: 500 })
    if (method === 'GET' && path === '/analyses') return Response.json(ANALYSES)
    if (method === 'GET' && path.endsWith('/library')) return Response.json(options.library ?? LIBRARY)
    if (method === 'GET' && path === '/researcher/projects') return Response.json(options.projects ?? PROJECTS)
    if (method === 'POST' && path === '/researcher/projects') return Response.json({ id: 'new1' })
    if (method === 'DELETE') return Response.json({ deleted: 'p1' })
    if (path.startsWith('/researcher/projects')) return Response.json({ id: 'p1' })
    return Response.json([])
  })
  vi.stubGlobal('fetch', stub)
  return calls
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderLibrary(search = '') {
  window.history.replaceState(null, '', `?role=researcher&screen=library${search}`)
  return render(
    <QueryClientProvider client={client()}>
      <ResearcherApp />
    </QueryClientProvider>,
  )
}

describe('project list', () => {
  it('shows each project with its counts, tally bar and update time', async () => {
    gateway()
    renderLibrary()
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByText('3 papers · 9 claims')).toBeInTheDocument()
    expect(screen.getByText('1 paper · 9 claims')).toBeInTheDocument()
    expect(screen.getByText('2 papers · not in a project yet')).toBeInTheDocument()
    expect(screen.getByText('Updated today')).toBeInTheDocument()
    expect(screen.getByText('New analyses land here')).toBeInTheDocument()
    // A project with no claims has no tally bar to draw.
    expect(document.querySelectorAll('.h-2.w-full').length).toBe(1)
  })

  it('opens a project when its card is clicked', async () => {
    gateway()
    renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: /^Open Retrieval survey, / }))
    expect(await screen.findByRole('heading', { name: 'Retrieval survey' })).toBeInTheDocument()
    expect(await screen.findByText('Tevatron toolkit')).toBeInTheDocument()
  })

  it('says the library could not load when the projects call fails', async () => {
    gateway({ fail: ['GET /researcher/projects'] })
    renderLibrary()
    expect(await screen.findByText('Your library could not load')).toBeInTheDocument()
  })

  it('shows a loading screen until the projects arrive', async () => {
    gateway()
    renderLibrary()
    expect(screen.getByText('Loading your projects…')).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Library' })
  })

  it('lists the projects when the host gives no way to analyse a new paper', async () => {
    gateway()
    render(
      <QueryClientProvider client={client()}>
        <Library onOpenAnalysis={() => {}} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })

  it('draws no Add papers menu when there is nothing to add', () => {
    const { container } = render(<LibraryAddMenu items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('the Add papers menu closes on Escape and on a click outside it', () => {
    const items = [
      { label: 'One', hint: 'first', onSelect: vi.fn() },
      { label: 'Two', hint: 'second', onSelect: vi.fn() },
    ]
    render(<LibraryAddMenu items={items} />)
    const add = screen.getByRole('button', { name: 'Add papers' })
    fireEvent.click(add)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(add)
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('a single way to add is the button itself, with its hint on hover, not a one-item menu', () => {
    const onSelect = vi.fn()
    render(<LibraryAddMenu items={[{ label: 'Analyze a new paper', hint: 'DOI, arXiv ID, link or PDF', onSelect }]} />)
    expect(screen.queryByRole('button', { name: 'Add papers' })).not.toBeInTheDocument()
    const only = screen.getByRole('button', { name: 'Analyze a new paper' })
    expect(only).toHaveAttribute('title', 'DOI, arXiv ID, link or PDF')
    fireEvent.click(only)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('opens Analyses from the Analyze a new paper button', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze a new paper' }))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('analyses')
  })

  it('filters the project grid by name, leaving Unsorted and the New project button on screen', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter projects' }), { target: { value: 'retrieval' } })
    expect(screen.getByRole('button', { name: /^Open Retrieval survey, / })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open Empty one, / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open Unsorted, / })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })

  it('says so, but still keeps Unsorted and the New project button, when no project matches', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter projects' }), { target: { value: 'nonexistent' } })
    expect(screen.getByText('No project matches "nonexistent".')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open Unsorted, / })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })

  it('sorts by name and by paper count, with Unsorted always last', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    const order = () =>
      screen
        .getAllByRole('button', { name: /^Open / })
        .map((b) => b.getAttribute('aria-label'))
        .map((label) => label!.split(', ')[0])
        .filter((label) => label !== 'Open the menu')

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(order()).toEqual(['Open Empty one', 'Open Retrieval survey', 'Open Unsorted'])

    fireEvent.click(screen.getByRole('button', { name: 'Papers' }))
    expect(order()).toEqual(['Open Retrieval survey', 'Open Empty one', 'Open Unsorted'])

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))
    expect(order()).toEqual(['Open Retrieval survey', 'Open Empty one', 'Open Unsorted'])
  })

  it('hides the filter and sort row when there are no named projects to filter', async () => {
    gateway({ projects: PROJECTS.filter((p) => p.unsorted) })
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    expect(screen.queryByRole('textbox', { name: 'Filter projects' })).not.toBeInTheDocument()
  })
})

describe('new project', () => {
  it('opens from ?new=1, and Escape closes it', async () => {
    gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens from the New project button and Cancel closes it', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('clicking the scrim closes it', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.firstElementChild!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('refuses a name another project already has, whatever its case, and says why', async () => {
    const calls = gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByPlaceholderText('e.g. Retrieval survey')
    fireEvent.change(name, { target: { value: ' retrieval SURVEY ' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A project called "retrieval SURVEY" already exists')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled()
    fireEvent.submit(name.closest('form')!)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    fireEvent.change(name, { target: { value: 'Another' } })
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'false')
  })

  it('while the project is being created the button is off, so a second submit makes no second project', async () => {
    const calls = gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog')
    const answer = vi.mocked(fetch).getMockImplementation()!
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') await held
      return answer(url, init)
    })
    const name = within(dialog).getByPlaceholderText('e.g. Retrieval survey')
    fireEvent.change(name, { target: { value: 'Graphs' } })
    fireEvent.submit(name.closest('form')!)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Creating…' })).toBeDisabled())
    fireEvent.submit(name.closest('form')!)
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/researcher/projects')).toHaveLength(1)
  })

  it('creates the project with a trimmed name and opens it', async () => {
    const calls = gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Retrieval survey'), { target: { value: '  Graphs  ' } })
    fireEvent.change(within(dialog).getByPlaceholderText('What is this project about?'), { target: { value: ' notes ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST', path: '/researcher/projects', body: { name: 'Graphs', description: 'notes' },
      }),
    )
    await waitFor(() => expect(calls.some((c) => c.path === '/researcher/projects/new1/library')).toBe(true))
  })

  it('keeps the dialog open and says so when creating fails', async () => {
    gateway({ fail: ['POST /researcher/projects'] })
    const error = vi.spyOn(toast, 'error')
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Retrieval survey'), { target: { value: 'Graphs' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not create the project. Try again.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not create a project from a blank name', async () => {
    const calls = gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Retrieval survey'), { target: { value: '   ' } })
    fireEvent.submit(dialog.querySelector('form')!)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('renaming and deleting', () => {
  async function openMenu(name = 'Retrieval survey') {
    const card = (await screen.findByText(name)).closest('.relative')! as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Project actions' }))
    return card
  }

  it('Unsorted has no project menu', async () => {
    gateway()
    renderLibrary()
    const card = (await screen.findByText('Unsorted')).closest('.relative')! as HTMLElement
    expect(within(card).queryByRole('button', { name: 'Project actions' })).not.toBeInTheDocument()
  })

  it('the menu closes on a click outside and on Escape', async () => {
    gateway()
    renderLibrary()
    await openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await openMenu()
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Rename saves the trimmed name on Enter', async () => {
    const calls = gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByDisplayValue('Retrieval survey')
    fireEvent.change(input, { target: { value: ' Renamed ' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/researcher/projects/p1', body: { name: 'Renamed' } }),
    )
    await waitFor(() => expect(screen.queryByDisplayValue('Renamed')).not.toBeInTheDocument())
  })

  it('stays in edit mode and says so when the rename fails', async () => {
    gateway({ fail: ['PATCH /researcher/projects/p1'] })
    const error = vi.spyOn(toast, 'error')
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByDisplayValue('Retrieval survey')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not rename the project. Try again.'))
    expect(screen.getByDisplayValue('Renamed')).toBeEnabled()
  })

  it('Rename to a name another project has says so and stays in the field', async () => {
    const calls = gateway()
    const error = vi.spyOn(toast, 'error')
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByDisplayValue('Retrieval survey')
    fireEvent.change(input, { target: { value: 'empty ONE' } })
    fireEvent.submit(input.closest('form')!)
    expect(error).toHaveBeenCalledWith('A project called "empty ONE" already exists. Choose another name.')
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    expect(screen.getByDisplayValue('empty ONE')).toBeEnabled()
  })

  it('Rename with an unchanged or blank name sends nothing and leaves edit mode', async () => {
    const calls = gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.submit(screen.getByDisplayValue('Retrieval survey').closest('form')!)
    expect(screen.queryByDisplayValue('Retrieval survey')).not.toBeInTheDocument()

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByDisplayValue('Retrieval survey')
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.submit(input.closest('form')!)
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('Escape and leaving the field cancel the rename and restore the name', async () => {
    gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    let input = screen.getByDisplayValue('Retrieval survey')
    fireEvent.change(input, { target: { value: 'half typed' } })
    fireEvent.keyDown(input, { key: 'a' })
    expect(screen.getByDisplayValue('half typed')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByText('Retrieval survey')).toBeInTheDocument()

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(screen.getByDisplayValue('Retrieval survey')).toBeInTheDocument()
    input = screen.getByDisplayValue('Retrieval survey')
    fireEvent.blur(input)
    expect(screen.getByText('Retrieval survey')).toBeInTheDocument()
  })

  it('Delete project asks first, then removes only the project', async () => {
    const calls = gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete "Retrieval survey"?')).toBeInTheDocument()
    expect(within(dialog).getByText(/Its 1 paper move back to Unsorted/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Delete project' })[0])
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: '/researcher/projects/p1', body: undefined }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('after a delete an Undo toast stays for 10 seconds and brings the project back', async () => {
    const calls = gateway()
    const message = vi.spyOn(toast, 'message')
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Delete project' })[0])
    await waitFor(() => expect(message).toHaveBeenCalled())
    const [text, options] = message.mock.calls.at(-1)!
    expect(text).toBe('Deleted "Retrieval survey"')
    expect(options).toMatchObject({ duration: 10_000, action: { label: 'Undo' } })
    const undo = (options as { action: { onClick: () => Promise<unknown> } }).action.onClick
    await undo()
    expect(calls).toContainEqual({ method: 'POST', path: '/researcher/projects/p1/restore', body: undefined })
  })

  it('says so when Undo cannot bring the project back', async () => {
    gateway({ fail: ['POST /researcher/projects/p1/restore'] })
    const message = vi.spyOn(toast, 'message')
    const error = vi.spyOn(toast, 'error')
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Delete project' })[0])
    await waitFor(() => expect(message).toHaveBeenCalled())
    const undo = (message.mock.calls.at(-1)![1] as { action: { onClick: () => Promise<unknown> } }).action.onClick
    await undo()
    expect(error).toHaveBeenCalledWith('Could not bring back "Retrieval survey". Try again.')
  })

  it('Cancel, Escape and the scrim dismiss the delete dialog', async () => {
    gateway()
    renderLibrary()
    for (const dismiss of [
      (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })),
      (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' }),
      (dialog: HTMLElement) => fireEvent.click(dialog.firstElementChild!),
    ]) {
      await openMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
      dismiss(screen.getByRole('dialog'))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })

  it('keeps the dialog shut against Escape and the scrim while the delete is running', async () => {
    let finish!: () => void
    const calls = gateway()
    const stub = vi.mocked(fetch)
    const inner = stub.getMockImplementation()!
    stub.mockImplementation(async (url, init) => {
      if (init?.method === 'DELETE') await new Promise<void>((resolve) => (finish = resolve))
      return inner(url, init)
    })
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Delete project' })[0])
    await screen.findByRole('button', { name: 'Deleting…' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(dialog.firstElementChild!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => finish())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })
})

describe('project detail', () => {
  it('shows a loading screen, then the papers with their standing and index notes', async () => {
    let release!: () => void
    gateway()
    const stub = vi.mocked(fetch)
    const inner = stub.getMockImplementation()!
    stub.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/library')) await new Promise<void>((resolve) => (release = resolve))
      return inner(url, init)
    })
    renderLibrary('&project=p1')
    expect(await screen.findByText('Loading this project…')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { name: 'Retrieval survey' })).toBeInTheDocument()
    expect(screen.getByText('4 papers · 16 claims · 12 checked')).toBeInTheDocument()
    expect(screen.getByText('Linked to ColBERTv2, PLAID')).toBeInTheDocument()
    expect(screen.getAllByText('Sources not in a public index')).toHaveLength(2)
    expect(screen.getByText('Not found in a public index')).toBeInTheDocument()
    expect(screen.getByText('1 contradicts')).toBeInTheDocument()
    expect(screen.getAllByText(/back it|backs it/).length).toBeGreaterThan(0)
  })

  it('names a project the list does not know "Project"', async () => {
    gateway()
    renderLibrary('&project=gone')
    expect(await screen.findByRole('heading', { name: 'Project' })).toBeInTheDocument()
  })

  it('says the project could not load when its library call fails', async () => {
    gateway({ fail: ['GET /researcher/projects/p1/library'] })
    renderLibrary('&project=p1')
    expect(await screen.findByText('This project could not load')).toBeInTheDocument()
  })

  it('goes back to the project list', async () => {
    gateway()
    renderLibrary('&project=p1')
    fireEvent.click(await screen.findByRole('button', { name: /← Projects/ }))
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })

  it('opens the analysis behind a paper row', async () => {
    gateway()
    renderLibrary('&project=p1')
    fireEvent.click((await screen.findByText('Silent only')).closest('button')!)
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('a4')
  })

  it('filters by segment, with Has conflicts second and Unverified shown as Not analyzed', async () => {
    gateway()
    renderLibrary('&project=p1')
    await screen.findByText('ColBERTv2')
    const segments = screen
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed') && /[0-9]$/.test(b.textContent ?? ''))
    expect(segments.map((b) => b.textContent)).toEqual([
      'All 4', 'Has conflicts 1', 'Not analyzed 1', 'Late interaction 1', 'Tooling 3',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Has conflicts 1' }))
    expect(screen.getByText('ColBERTv2')).toBeInTheDocument()
    expect(screen.queryByText('Tevatron toolkit')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Not analyzed 1' }))
    expect(screen.getByText('Tevatron toolkit')).toBeInTheDocument()
    expect(screen.queryByText('ColBERTv2')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tooling 3' }))
    expect(screen.getByText('Backed only')).toBeInTheDocument()
    expect(screen.queryByText('ColBERTv2')).not.toBeInTheDocument()
  })

  it('filters by the typed text, and starts from ?q=', async () => {
    gateway()
    renderLibrary('&project=p1&q=gao')
    expect(await screen.findByText('Tevatron toolkit')).toBeInTheDocument()
    expect(screen.queryByText('ColBERTv2')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter papers' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No papers match.')).toBeInTheDocument()
  })

  it('folds rows past seven behind Show all', async () => {
    const many = Array.from({ length: 9 }, (_, i) => paper({ id: `m${i}`, title: `Paper ${i}`, cluster: '' }))
    gateway({ library: { summary: '', clusters: [], papers: many } })
    renderLibrary('&project=p1')
    await screen.findByText('Paper 0')
    expect(screen.queryByText('Paper 8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 9 papers' }))
    expect(screen.getByText('Paper 8')).toBeInTheDocument()
    // No clusters, so no Cluster column and no segment buttons besides the conflicts one.
    expect(screen.queryByText('Cluster')).not.toBeInTheDocument()
  })

  it('says a project with no papers is empty', async () => {
    gateway({ library: { summary: '', clusters: [], papers: [] } })
    renderLibrary('&project=p2')
    expect(await screen.findByText('No papers in this project yet.')).toBeInTheDocument()
  })

  it('lists only the analysed-papers action in a real project, and none for Unsorted', async () => {
    gateway()
    const first = renderLibrary('&project=p1')
    await screen.findByText('ColBERTv2')
    fireEvent.click(screen.getByRole('button', { name: 'Add papers' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    first.unmount()

    renderLibrary('&project=unsorted')
    await screen.findByText('ColBERTv2')
    // One action left, so it is a plain button.
    expect(screen.queryByRole('button', { name: 'Add papers' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyze a new paper' })).toBeInTheDocument()
  })
})

describe('adding analysed papers', () => {
  async function openPicker() {
    renderLibrary('&project=p1')
    await screen.findByText('ColBERTv2')
    fireEvent.click(screen.getByRole('button', { name: 'Add papers' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /From your analysed papers/ }))
    return screen.findByRole('dialog')
  }

  it('lists finished analyses not yet in the project, with a title or file name', async () => {
    gateway()
    const dialog = await openPicker()
    // a1 is already in the project and a8 is still running.
    expect(within(dialog).queryByText('ColBERTv2')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Running one')).not.toBeInTheDocument()
    expect(within(dialog).getByText('PLAID')).toBeInTheDocument()
    expect(within(dialog).getByText('new.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('p.pdf')).toBeInTheDocument()
  })

  it('adds the chosen papers one after the other, and turns the controls off meanwhile', async () => {
    let finish!: () => void
    const calls = gateway()
    const stub = vi.mocked(fetch)
    const inner = stub.getMockImplementation()!
    stub.mockImplementation(async (url, init) => {
      if (init?.method === 'POST' && String(url).endsWith('/papers')) await new Promise<void>((r) => (finish = r))
      return inner(url, init)
    })
    const dialog = await openPicker()
    await within(dialog).findByRole('checkbox', { name: 'PLAID' })
    const add = () => within(dialog).getByRole('button', { name: /^Add( \d)?/ })
    expect(add()).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'PLAID' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'new.pdf' }))
    expect(add()).toHaveTextContent('Add 2 papers')
    fireEvent.click(add())
    await within(dialog).findByRole('button', { name: 'Adding…' })
    expect(within(dialog).getByRole('checkbox', { name: 'PLAID' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Select all' })).toBeDisabled()
    await act(async () => finish())
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/papers'))).toHaveLength(1))
    await act(async () => finish())
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/papers')).map((c) => c.body)).toEqual([
        { analysis_id: 'a5' },
        { analysis_id: 'a6' },
      ]),
    )
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Adding…' })).not.toBeInTheDocument())
  })

  it('Select all chooses every paper in the list and Clear takes them back', async () => {
    gateway()
    const dialog = await openPicker()
    const boxes = () => within(dialog).getAllByRole('checkbox')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all' }))
    expect(boxes().every((box) => (box as HTMLInputElement).checked)).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Add 3 papers' })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
    expect(boxes().some((box) => (box as HTMLInputElement).checked)).toBe(false)
    fireEvent.click(boxes()[0])
    fireEvent.click(boxes()[0])
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('keeps the papers that failed chosen, names them, and still adds the others', async () => {
    const calls = gateway()
    const error = vi.spyOn(toast, 'error')
    const stub = vi.mocked(fetch)
    const inner = stub.getMockImplementation()!
    stub.mockImplementation(async (url, init) => {
      if (init?.method === 'POST' && String(init.body).includes('a5')) return new Response('{}', { status: 500 })
      return inner(url, init)
    })
    const dialog = await openPicker()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 3 papers' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not add PLAID. Try again.'))
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/papers'))).toHaveLength(2)
    expect(within(dialog).getByRole('checkbox', { name: 'PLAID' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Add 1 paper' })).toBeEnabled()
  })

  it('says no paper is analysed yet while the analyses are still loading', async () => {
    gateway()
    const stub = vi.mocked(fetch)
    const answer = stub.getMockImplementation()!
    stub.mockImplementation(async (url, init) =>
      String(url) === '/api/analyses' ? new Promise<Response>(() => {}) : answer(url, init),
    )
    const dialog = await openPicker()
    expect(within(dialog).getByText('No paper is analysed yet. Analyse one in Analyses first.')).toBeInTheDocument()
  })

  it('says so when every analysed paper is already in the project', async () => {
    gateway({ library: { ...LIBRARY, papers: [paper({ id: 'a1' }), paper({ id: 'a5', title: 'B' }), paper({ id: 'a6', title: 'C' }), paper({ id: 'a7', title: 'D' })] } })
    const dialog = await openPicker()
    expect(within(dialog).getByText('Every analysed paper is already in this project.')).toBeInTheDocument()
  })

  it.each([
    ['Done', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))],
    ['Escape', (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' })],
    ['the scrim', (dialog: HTMLElement) => fireEvent.click(dialog.firstElementChild!)],
  ] as const)('closes with %s', async (_name, dismiss) => {
    gateway()
    const dialog = await openPicker()
    dismiss(dialog)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    cleanup()
  })
})

describe('updatedText', () => {
  const base = { id: 'p', name: 'P', papers: 0, claims: 0, clusters: 0, tally: NO_TALLY }
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000 - 1000).toISOString()

  it('words each age', () => {
    expect(updatedText({ ...base, updated: ago(0) })).toBe('Updated today')
    expect(updatedText({ ...base, updated: ago(1) })).toBe('Updated yesterday')
    expect(updatedText({ ...base, updated: ago(5) })).toBe('Updated 5 days ago')
    expect(updatedText({ ...base, updated: '' })).toBe('')
    expect(updatedText({ ...base, updated: '', unsorted: true })).toBe('New analyses land here')
  })
})

describe('keyboard use and recovery', () => {
  async function openMenu() {
    const card = (await screen.findByText('Retrieval survey')).closest('.relative')! as HTMLElement
    const button = within(card).getByRole('button', { name: 'Project actions' })
    fireEvent.click(button)
    return button
  }

  it('the project menu takes focus, moves with the arrow keys and Escape gives focus back', async () => {
    gateway()
    renderLibrary()
    const card = (await screen.findByText('Retrieval survey')).closest('.relative')! as HTMLElement
    const button = within(card).getByRole('button', { name: 'Project actions' })
    fireEvent.keyDown(button, { key: 'ArrowDown' }) // closed: nothing to move through
    fireEvent.click(button)
    const [rename, remove] = screen.getAllByRole('menuitem')
    expect(rename).toHaveFocus()
    fireEvent.keyDown(rename, { key: 'ArrowDown' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'ArrowDown' })
    expect(rename).toHaveFocus()
    fireEvent.keyDown(rename, { key: 'ArrowUp' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'Home' })
    expect(rename).toHaveFocus()
    fireEvent.keyDown(rename, { key: 'End' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'a' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('leaving the rename field saves a changed name', async () => {
    const calls = gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/researcher/projects/p1', body: { name: 'Renamed' } }),
    )
  })

  it('Enter followed by the blur it causes saves once', async () => {
    const calls = gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.blur(input)
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  })

  it('Delete project starts on Cancel, and the dialog is named by its title', async () => {
    gateway()
    renderLibrary()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete "Retrieval survey"?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('the new-project fields have labels', async () => {
    gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    expect(within(dialog).getByLabelText('Project name')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Description (optional)')).toBeInTheDocument()
  })

  it('offers Retry when the projects fail to load, and shows them once they do', async () => {
    gateway({ fail: ['GET /researcher/projects'] })
    renderLibrary()
    expect(await screen.findByText('Your library could not load')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    gateway()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Retrieval survey')).toBeInTheDocument()
  })

  it('offers Retry when a project fails to load, and shows it once it does', async () => {
    gateway({ fail: ['GET /researcher/projects/p1/library'] })
    renderLibrary('&project=p1')
    expect(await screen.findByText('This project could not load')).toBeInTheDocument()
    gateway()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Tevatron toolkit')).toBeInTheDocument()
  })
})

describe('the paper table sort', () => {
  const titles = () => [...document.querySelectorAll('button span.block.truncate')].map((p) => p.textContent)

  it('sorts by title, by claims and by conflicts, and a second press goes back to the usual order', async () => {
    gateway()
    renderLibrary('&project=p1')
    await screen.findByText('Tevatron toolkit')
    const usual = ['ColBERTv2', 'Tevatron toolkit', 'Backed only', 'Silent only']
    expect(titles()).toEqual(usual)

    fireEvent.click(screen.getByRole('button', { name: 'Paper' }))
    expect(titles()).toEqual(['Backed only', 'ColBERTv2', 'Silent only', 'Tevatron toolkit'])

    fireEvent.click(screen.getByRole('button', { name: 'Claims' }))
    expect(titles()).toEqual(['ColBERTv2', 'Tevatron toolkit', 'Silent only', 'Backed only'])
    expect(screen.getByRole('button', { name: 'Claims' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Standing' }))
    expect(titles()).toEqual(['ColBERTv2', 'Backed only', 'Tevatron toolkit', 'Silent only'])

    fireEvent.click(screen.getByRole('button', { name: 'Standing' }))
    expect(titles()).toEqual(usual)
  })
})

describe('dialog focus', () => {
  it('Tab stays inside the New project dialog, in both directions, and Escape closes it', async () => {
    gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    const name = within(dialog).getByLabelText('Project name')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    // "Create project" is disabled until there is a name, so Cancel is the last stop.
    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(name).toHaveFocus()
    fireEvent.keyDown(name, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    // Away from the edges Tab is left to the browser.
    name.focus()
    fireEvent.keyDown(name, { key: 'Tab' })
    expect(name).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Shift+Tab from the dialog itself wraps to its last stop instead of leaving it', async () => {
    gateway()
    renderLibrary('&new=1')
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    // Plain Tab from the dialog itself is the browser's: it goes to the first stop on its own.
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(cancel).not.toHaveFocus()
  })

  it('focus goes back to the button that opened the dialog', async () => {
    gateway()
    renderLibrary()
    const opener = await screen.findByRole('button', { name: 'New project' })
    opener.focus() // a real click focuses the button; fireEvent.click does not
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'New project' })).toHaveFocus())
  })

  it('a dialog opened from a menu gives focus back to the menu button, not to the item that went away', async () => {
    gateway()
    renderLibrary()
    const card = (await screen.findByText('Retrieval survey')).closest('.relative')! as HTMLElement
    const button = within(card).getByRole('button', { name: 'Project actions' })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('under StrictMode, the dialog that mounts twice keeps focus inside itself', async () => {
    gateway()
    window.history.replaceState(null, '', '?role=researcher&screen=library&new=1')
    render(
      <StrictMode>
        <QueryClientProvider client={client()}>
          <ResearcherApp />
        </QueryClientProvider>
      </StrictMode>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await new Promise((resolve) => setTimeout(resolve, 20)) // let the deferred focus restore run
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('the project menu closes when focus leaves it, and stays open while focus moves inside it', async () => {
    gateway()
    renderLibrary()
    const card = (await screen.findByText('Retrieval survey')).closest('.relative')! as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Project actions' }))
    const [rename, remove] = screen.getAllByRole('menuitem')
    fireEvent.blur(rename, { relatedTarget: remove })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.blur(remove, { relatedTarget: document.body })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('an Escape that cancels a rename wins over a blur that arrives while the field is removed', async () => {
    const calls = gateway()
    renderLibrary()
    const card = (await screen.findByText('Retrieval survey')).closest('.relative')! as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Project actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'half typed' } })
    // Some browsers blur a focused field as they remove it, in the same turn as the Escape.
    input.addEventListener('keydown', () => queueMicrotask(() => fireEvent.blur(input)), { once: true })
    fireEvent.keyDown(input, { key: 'Escape' })
    await Promise.resolve()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    expect(screen.getByText('Retrieval survey')).toBeInTheDocument()
  })
})

describe('failures say so', () => {
  it('a project that cannot be deleted keeps its dialog and shows a message', async () => {
    gateway({ fail: ['DELETE /researcher/projects/p1'] })
    const error = vi.spyOn(toast, 'error')
    renderLibrary()
    const card = (await screen.findByText('Retrieval survey')).closest('.relative')! as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Project actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not delete the project. Try again.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a paper that cannot be added shows a message', async () => {
    gateway({ fail: ['POST /researcher/projects/p1/papers'] })
    const error = vi.spyOn(toast, 'error')
    renderLibrary('&project=p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Add papers' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /From your analysed papers/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'PLAID' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 paper' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not add PLAID. Try again.'))
  })
})

describe('browser history and the / shortcut', () => {
  it('opening a project adds a history entry, Back returns to the list and Forward reopens it', async () => {
    gateway()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.click(screen.getByRole('button', { name: /^Open Retrieval survey, / }))
    expect(await screen.findByRole('heading', { name: 'Retrieval survey' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('project')).toBe('p1')

    act(() => {
      window.history.back()
    })
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('project')).toBeNull()

    act(() => {
      window.history.forward()
    })
    expect(await screen.findByRole('heading', { name: 'Retrieval survey' })).toBeInTheDocument()
  })

  it('← Projects goes back to the list and drops the project from the URL', async () => {
    gateway()
    renderLibrary('&project=p1')
    fireEvent.click(await screen.findByRole('button', { name: /← Projects/ }))
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('project')).toBeNull()
  })

  it('/ focuses the project filter, and the paper filter inside a project', async () => {
    gateway()
    const first = renderLibrary()
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.keyDown(document.body, { key: '/' })
    expect(screen.getByRole('textbox', { name: 'Filter projects' })).toHaveFocus()
    first.unmount()

    renderLibrary('&project=p1')
    await screen.findByText('ColBERTv2')
    fireEvent.keyDown(document.body, { key: '/' })
    expect(screen.getByRole('textbox', { name: 'Filter papers' })).toHaveFocus()
  })
})
