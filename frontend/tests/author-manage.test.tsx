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
  const view = renderWithQuery(<Library projectId={projectId} onOpenProject={onOpenProject} onOpenEditor={vi.fn()} onOpenDraft={vi.fn()} />)
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
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('POST /author/projects')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: /\+ New project/ }))
    expect(dialog().getByLabelText('Project name')).toHaveAttribute('placeholder', 'Untitled project')
    fireEvent.click(dialog().getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled())
    const created = [...gateway.projects.values()].find((p) => p.id === onOpenProject.mock.calls[0][0])
    expect(created?.name).toBe('Untitled project')
    expect(created?.bib?.content).toBe('')
  })

  test('"+ New project" by name trims it, and still offers the .bib / .zip import', async () => {
    const { onOpenProject } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    expect(dialog().getByRole('button', { name: /Import a \.bib or an Overleaf \.zip/ })).toBeInTheDocument()
    fireEvent.change(dialog().getByLabelText('Project name'), { target: { value: '  Thesis   ch.3 ' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled())
    expect(gateway.projects.get(onOpenProject.mock.calls[0][0])?.name).toBe('Thesis ch.3')

    // Import closes the dialog and hands over to the file input the "Import .bib" button uses.
    fireEvent.click(screen.getByRole('button', { name: /\+ New project/ }))
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
    expect(await screen.findByRole('button', { name: /Unsorted sources/ })).toHaveTextContent('2 drafts in no project')
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

describe('Home: Your drafts', () => {
  beforeEach(() => {
    gateway = installFakeGateway({ files: THESIS_FILES })
  })

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
})
