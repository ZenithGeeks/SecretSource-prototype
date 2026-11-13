/**
 * Managing the Author's drafts and projects against the fake gateway (SCRUM-467): deleting a
 * draft from Home and from a project, renaming and deleting a project from its Library card and
 * its page, and "+ New project" making an empty project. Every confirm dialog is also cancelled,
 * and a refusal from the gateway shows inline instead of closing anything.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { backupKey } from '../src/lib/draftSave'
import { AuthorApp } from '../src/roles/author/AuthorApp'
import { Home } from '../src/roles/author/screens/Home'
import { Library } from '../src/roles/author/screens/Library'
import { installFakeGateway, runCheck, type FakeGateway } from './fakeAuthorGateway'
import { MAIN_BIB, RELATED_WORK_TEX, THESIS_FILES } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderLibrary(projectId: string | null = null) {
  const onOpenProject = vi.fn()
  const view = renderWithQuery(<Library projectId={projectId} onOpenProject={onOpenProject} onOpenEditor={vi.fn()} />)
  return { ...view, onOpenProject }
}

const calls = (prefix: string) => gateway.calls.filter((c) => c.startsWith(prefix))
const dialog = () => within(screen.getByRole('dialog'))

async function openMenu(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('Library: projects', () => {
  beforeEach(() => {
    gateway = installFakeGateway({ files: [{ name: 'related-work.tex', content: RELATED_WORK_TEX }], prechecked: false })
    gateway.projects.get('proj1')!.bib = { name: 'main.bib', content: MAIN_BIB }
    gateway.drafts.get('d2')!.projectId = null
    runCheck(gateway, 'd1')
  })

  test('"+ New project" with no name makes "Untitled project" and opens it; Cancel makes nothing', async () => {
    const { onOpenProject } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('POST /author/projects')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(dialog().getByLabelText('Project name')).toHaveAttribute('placeholder', 'Untitled project')
    fireEvent.click(dialog().getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled())
    const created = [...gateway.projects.values()].find((p) => p.id === onOpenProject.mock.calls[0][0])
    expect(created?.name).toBe('Untitled project')
    expect(created?.bib?.content).toBe('')
  })

  test('"+ New project" by name trims it, and still offers the .bib / .zip import', async () => {
    const { onOpenProject } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    expect(dialog().getByRole('button', { name: /Import a \.bib or an Overleaf \.zip/ })).toBeInTheDocument()
    fireEvent.change(dialog().getByLabelText('Project name'), { target: { value: '  Thesis   ch.3 ' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled())
    expect(gateway.projects.get(onOpenProject.mock.calls[0][0])?.name).toBe('Thesis ch.3')

    // Import closes the dialog and hands over to the file input the "Import .bib" button uses.
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    fireEvent.click(dialog().getByRole('button', { name: /Import a \.bib or an Overleaf \.zip/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Import a .bib or an Overleaf .zip')).toBeInTheDocument()
  })

  test('Rename on a card: the new name shows at once; empty is refused; Esc keeps the old one', async () => {
    renderLibrary()
    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const field = screen.getByLabelText('Project name')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.submit(field)
    expect(await screen.findByRole('alert')).toHaveTextContent('A project needs a name')
    expect(calls('PATCH /author/projects')).toEqual([])
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Open Related work — thesis ch.2' })).toBeInTheDocument()

    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Chapter   2 ' } })
    fireEvent.submit(screen.getByLabelText('Project name'))
    expect(await screen.findByRole('button', { name: 'Open Chapter 2' })).toBeInTheDocument()
    expect(calls('PATCH /author/projects')).toEqual(['PATCH /author/projects/proj1'])
    expect(gateway.projects.get('proj1')?.name).toBe('Chapter 2')
  })

  test('a rename the gateway refuses stays open with its reason', async () => {
    renderLibrary()
    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    gateway.projects.delete('proj1') // gone elsewhere: the PATCH answers 404
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Chapter 2' } })
    fireEvent.submit(screen.getByLabelText('Project name'))
    expect(await screen.findByRole('alert')).toHaveTextContent('no such project')
    expect(screen.getByLabelText('Project name')).toBeInTheDocument()
  })

  test('Delete on a card says what moves to Unsorted; Cancel keeps it, Delete removes it', async () => {
    gateway.sources.set('s1', { id: 's1', projectId: 'proj1', key: 'formal2021', title: 'SPLADE v2', authors: 'Formal et al.', authorsList: ['Thibault Formal'], year: 2021, venue: '', doi: '', arxiv: '', url: '', identifier: '', openAccess: true, citedBy: 1, bibtex: '', inBib: false, bibName: 'main.bib', savedAt: '2026-09-27T00:00:00Z' })
    renderLibrary()
    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    expect(dialog().getByRole('heading', { name: 'Delete “Related work — thesis ch.2”?' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('Its 1 draft and 1 saved source move to Unsorted.')
    expect(screen.getByRole('dialog')).toHaveTextContent('main.bib (7 entries) and the PDFs attached to it are deleted')

    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('DELETE /author/projects')).toEqual([])

    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Related work — thesis ch.2' })).not.toBeInTheDocument())
    expect(calls('DELETE /author/projects')).toEqual(['DELETE /author/projects/proj1'])
    expect(await screen.findByRole('button', { name: /Unsorted sources/ })).toHaveAccessibleName(/2 drafts in no project/)
    expect(gateway.sources.get('s1')?.projectId).toBeNull()
  })

  test('a delete the gateway refuses keeps the dialog open with its reason', async () => {
    renderLibrary()
    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    gateway.projects.delete('proj1')
    fireEvent.click(dialog().getByRole('button', { name: 'Delete project' }))
    expect(await dialog().findByRole('alert')).toHaveTextContent('no such project')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Project page', () => {
  beforeEach(() => {
    gateway = installFakeGateway({ files: [{ name: 'related-work.tex', content: RELATED_WORK_TEX }], prechecked: false })
    gateway.projects.get('proj1')!.bib = { name: 'main.bib', content: MAIN_BIB }
  })

  test('Rename from the page heading shows the new name at once', async () => {
    renderLibrary('proj1')
    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Chapter 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Chapter 2' })).toBeInTheDocument()
  })

  test('Delete project from its page goes back to the Library', async () => {
    const { onOpenProject } = renderLibrary('proj1')
    await openMenu('Related work — thesis ch.2')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Its 2 drafts and 0 saved sources move to Unsorted.')
    fireEvent.click(dialog().getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(null))
    expect(gateway.projects.has('proj1')).toBe(false)
    expect(gateway.drafts.get('d1')?.projectId).toBeNull()
  })

  test('a draft deletes from the project list after a confirm, and its unsaved copy goes with it', async () => {
    window.localStorage.setItem(backupKey('d1'), JSON.stringify({ at: '2026-10-30T00:00:00Z', files: { 'related-work.tex': 'x' } }))
    renderLibrary('proj1')
    const list = within(await screen.findByRole('list', { name: 'Drafts in this project' }))
    expect(list.getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(list.getByRole('button', { name: 'Delete Related work — thesis ch.2' }))
    expect(dialog().getByRole('heading', { name: 'Delete “Related work — thesis ch.2”?' })).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('DELETE /author/drafts')).toEqual([])

    fireEvent.click(list.getByRole('button', { name: 'Delete Related work — thesis ch.2' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Drafts in this project' })).getAllByRole('listitem')).toHaveLength(1))
    expect(calls('DELETE /author/drafts')).toEqual(['DELETE /author/drafts/d1'])
    expect(window.localStorage.getItem(backupKey('d1'))).toBeNull()
    expect(screen.getByRole('heading', { name: /Check history · Seminar paper/ })).toBeInTheDocument()
  })
})

describe('A project page: deleting a draft', () => {
  beforeEach(() => {
    gateway = installFakeGateway({ files: THESIS_FILES })
    window.history.replaceState(null, '', '?screen=library&project=proj1&draft=d1')
  })
  afterEach(() => window.history.replaceState(null, '', window.location.pathname))
  const draftInUrl = () => new URLSearchParams(window.location.search).get('draft')
  const projectList = async () => within(await screen.findByRole('list', { name: 'Drafts in this project' }))

  test('the selected draft clears draftId and ?draft=', async () => {
    renderWithQuery(<AuthorApp />)
    const title = gateway.drafts.get('d1')!.title
    fireEvent.click((await projectList()).getByRole('button', { name: `Delete ${title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(draftInUrl()).toBeNull())
    expect(await screen.findByText(`${title} deleted`)).toBeInTheDocument()
  })

  test('the last draft clears them too, and Home then has nothing to open', async () => {
    gateway.drafts.delete('d2')
    renderWithQuery(<AuthorApp />)
    const title = gateway.drafts.get('d1')!.title
    fireEvent.click((await projectList()).getByRole('button', { name: `Delete ${title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(draftInUrl()).toBeNull())

    fireEvent.click(within(screen.getAllByRole('navigation')[0]).getByRole('button', { name: 'Home' }))
    expect(await screen.findByRole('heading', { name: 'No drafts yet' })).toBeInTheDocument()
    expect(draftInUrl()).toBeNull()
  })

  test('another draft leaves the selection alone', async () => {
    renderWithQuery(<AuthorApp />)
    fireEvent.click((await projectList()).getByRole('button', { name: 'Delete Seminar paper (CPE)' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(gateway.drafts.has('d2')).toBe(false))
    await screen.findByText('Seminar paper (CPE) deleted')
    expect(draftInUrl()).toBe('d1')
  })

  test('a draft already deleted elsewhere clears them as well, with a short note', async () => {
    renderWithQuery(<AuthorApp />)
    const list = await projectList()
    const title = gateway.drafts.get('d1')!.title
    gateway.drafts.delete('d1')
    fireEvent.click(list.getByRole('button', { name: `Delete ${title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    expect(await screen.findByText(`${title} was already deleted`)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(draftInUrl()).toBeNull()
  })
})

describe('Home: Your drafts', () => {
  beforeEach(() => {
    gateway = installFakeGateway({ files: THESIS_FILES })
  })
  afterEach(() => window.history.replaceState(null, '', window.location.pathname))

  function renderHome(draftId: string) {
    const onSelectDraft = vi.fn()
    renderWithQuery(<Home draftId={draftId} onSelectDraft={onSelectDraft} onOpenEditor={vi.fn()} onOpenHistory={vi.fn()} />)
    return { onSelectDraft }
  }

  test('deleting the open draft asks first, then opens its neighbour', async () => {
    window.localStorage.setItem(backupKey('d1'), JSON.stringify({ at: '2026-10-30T00:00:00Z', files: { 'main.tex': 'x' } }))
    const { onSelectDraft } = renderHome('d1')
    const drafts = within(await screen.findByRole('list', { name: 'Drafts' }))
    const title = gateway.drafts.get('d1')!.title

    fireEvent.click(drafts.getByRole('button', { name: `Delete ${title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('DELETE /author/drafts')).toEqual([])

    fireEvent.click(drafts.getByRole('button', { name: `Delete ${title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(onSelectDraft).toHaveBeenCalledWith('d2'))
    expect(calls('DELETE /author/drafts')).toEqual(['DELETE /author/drafts/d1'])
    expect(gateway.drafts.has('d1')).toBe(false)
    expect(window.localStorage.getItem(backupKey('d1'))).toBeNull()
  })

  test('deleting another draft keeps the open one', async () => {
    const { onSelectDraft } = renderHome('d1')
    const drafts = within(await screen.findByRole('list', { name: 'Drafts' }))
    fireEvent.click(drafts.getByRole('button', { name: 'Delete Seminar paper (CPE)' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Seminar paper (CPE)' })).not.toBeInTheDocument())
    expect(onSelectDraft).not.toHaveBeenCalled()
  })

  test('deleting the last draft clears the selection and ?draft=, and Home shows its empty state', async () => {
    gateway.drafts.delete('d2')
    window.history.replaceState(null, '', '?screen=home&draft=d1')
    renderWithQuery(<AuthorApp />)
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${gateway.drafts.get('d1')!.title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))

    expect(await screen.findByRole('heading', { name: 'No drafts yet' })).toBeInTheDocument()
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('draft')).toBe(false))
    expect(gateway.drafts.size).toBe(0)
  })

  test('a refused delete says why in the dialog, stays usable, and a retry can succeed', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.reject(new Error('500: {"detail":"the store is down"}')) : real(input, init),
    )
    const { onSelectDraft } = renderHome('d1')
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${gateway.drafts.get('d1')!.title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))

    expect(await dialog().findByRole('alert')).toHaveTextContent('the store is down')
    const again = dialog().getByRole('button', { name: 'Delete draft' })
    expect(again).toBeEnabled()
    expect(dialog().getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(gateway.drafts.has('d1')).toBe(true)
    expect(onSelectDraft).not.toHaveBeenCalled()

    gateway.fetch.mockImplementation(real)
    fireEvent.click(again)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(gateway.drafts.has('d1')).toBe(false)
    expect(onSelectDraft).toHaveBeenCalledWith('d2')
  })

  test('a delete that gets a bare 502 from a proxy still says what happened', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.resolve(new Response('', { status: 502 })) : real(input, init),
    )
    renderHome('d1')
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${gateway.drafts.get('d1')!.title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    expect(await dialog().findByRole('alert')).toHaveTextContent('the server did not answer (502)')
    expect(dialog().getByRole('button', { name: 'Delete draft' })).toBeEnabled()
  })

  test('a draft already deleted elsewhere counts as deleted: row gone, dialog closed, and a short note', async () => {
    const { onSelectDraft } = renderHome('d1')
    const drafts = within(await screen.findByRole('list', { name: 'Drafts' }))
    const title = gateway.drafts.get('d1')!.title
    gateway.drafts.delete('d1') // another tab
    fireEvent.click(drafts.getByRole('button', { name: `Delete ${title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(`${title} was already deleted`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Delete ${title}` })).not.toBeInTheDocument()
    expect(onSelectDraft).toHaveBeenCalledWith('d2')
  })

  test('another 404 is still an error, not "already deleted"', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.resolve(new Response('Not Found', { status: 404 })) : real(input, init),
    )
    renderHome('d1')
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${gateway.drafts.get('d1')!.title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    expect(await dialog().findByRole('alert')).toHaveTextContent('Not Found')
    expect(gateway.drafts.has('d1')).toBe(true)
  })

  test('a refused delete can be cancelled', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.reject(new Error('500: {"detail":"the store is down"}')) : real(input, init),
    )
    renderHome('d1')
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${gateway.drafts.get('d1')!.title}` }))
    fireEvent.click(dialog().getByRole('button', { name: 'Delete draft' }))
    await dialog().findByRole('alert')
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(gateway.drafts.has('d1')).toBe(true)
  })
})
