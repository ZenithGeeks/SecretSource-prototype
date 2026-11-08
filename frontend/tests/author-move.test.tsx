/**
 * #721: moving drafts between projects. "+ New project" can take existing drafts along; each
 * draft row in Unsorted and in a project has "Move to…" (another project, Unsorted, or a new
 * project). All of it goes through the gateway's own move, PATCH /drafts/{id} with the
 * project's id ("" for Unsorted), and warns about cited keys only the old project's .bib holds.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { keysLostByMove } from '../src/lib/latexProject'
import { Library } from '../src/roles/author/screens/Library'
import type { ProjectFile } from '../src/types/draftCheck'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

let gateway: FakeGateway
const THESIS = 'Related work — thesis ch.2'
const SEMINAR = 'Seminar paper (CPE)'

beforeEach(() => {
  // The project owns the .bib and the thesis draft holds only its chapter, as an import makes
  // them; the seminar paper is in no project and carries its own refs.bib.
  gateway = installFakeGateway({ files: [{ name: 'related-work.tex', content: RELATED_WORK_TEX }] })
  gateway.projects.get('proj1')!.bib = { name: 'main.bib', content: MAIN_BIB }
  gateway.drafts.get('d2')!.projectId = null
})
afterEach(() => vi.unstubAllGlobals())

function renderLibrary(projectId: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onOpenProject = vi.fn()
  const ui: ReactNode = <Library projectId={projectId} onOpenProject={onOpenProject} onOpenEditor={vi.fn()} />
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  return { onOpenProject }
}

const patches = () => gateway.calls.filter((c) => c.startsWith('PATCH /author/drafts/'))

describe('keysLostByMove', () => {
  const tex = (content: string): ProjectFile => ({ name: 'a.tex', kind: 'tex', content })
  const files = [tex(String.raw`\cite{x,y,z}`), { name: 'own.bib', kind: 'bib' as const, content: '@misc{x, doi={1}}' }]
  const from = { name: 'main.bib', content: '@misc{y, doi={2}}\n@misc{z, doi={3}}\n@misc{unused, doi={4}}' }

  test('the cited keys only the old project’s .bib defines', () => {
    expect(keysLostByMove(files, from, null)).toEqual(['y', 'z'])
  })
  test('none that the new project’s .bib also has', () => {
    expect(keysLostByMove(files, from, { name: 'refs.bib', content: '@misc{z, doi={3}}' })).toEqual(['y'])
  })
  test('none when the draft did not read that .bib (a file of the same name of its own), or came from Unsorted', () => {
    expect(keysLostByMove([...files, { name: 'main.bib', kind: 'bib', content: '' }], from, null)).toEqual([])
    expect(keysLostByMove(files, null, null)).toEqual([])
  })
})

describe('Moving drafts (#721)', () => {
  test('"+ New project" takes existing drafts along, grouped Unsorted then by project, and warns about keys left behind', async () => {
    const { onOpenProject } = renderLibrary(null)
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    const picker = within(await dialog.findByRole('group', { name: 'Add existing drafts (optional)' }))
    expect(picker.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Unsorted', THESIS])
    const unsorted = within(picker.getByRole('group', { name: 'Unsorted' }))
    const thesis = within(picker.getByRole('group', { name: THESIS }))

    fireEvent.click(unsorted.getByRole('checkbox', { name: SEMINAR }))
    // the seminar paper has its own .bib: nothing to say
    expect(dialog.queryByRole('status')).toBeNull()
    fireEvent.click(thesis.getByRole('checkbox', { name: THESIS }))
    const warning = await dialog.findByRole('status')
    expect(warning).toHaveTextContent(/cites .*\\cite\{khattab2020\}.*defined only in Related work — thesis ch\.2’s main\.bib/)
    expect(warning).toHaveTextContent('show as missing')

    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Chapter 3' } })
    const form = dialog.getByRole('button', { name: 'Create project' }).closest('form')!
    // a double submit makes one project
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledTimes(1))
    expect(gateway.calls.filter((c) => c === 'POST /author/projects')).toHaveLength(1)
    const created = onOpenProject.mock.calls[0][0] as string
    expect(gateway.drafts.get('d1')!.projectId).toBe(created)
    expect(gateway.drafts.get('d2')!.projectId).toBe(created)
    expect(await screen.findByText('Chapter 3 created with 2 drafts')).toBeInTheDocument()
  })

  test('Unsorted → a project: "Move to…" lists the projects, asks, moves, and the list refreshes', async () => {
    renderLibrary('unsorted')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${SEMINAR} to…` }))
    const menu = within(screen.getByRole('menu', { name: `Move ${SEMINAR} to` }))
    // no "Unsorted" for a draft already there
    expect(menu.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([THESIS, 'New project…'])
    fireEvent.click(menu.getByRole('menuitem', { name: THESIS }))
    const confirm = within(screen.getByRole('dialog', { name: `Move ${SEMINAR}` }))
    expect(confirm.getByText(`Move “${SEMINAR}” to ${THESIS}?`)).toBeInTheDocument()
    // Move waits for the .bib files the warning compares
    expect(confirm.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(confirm.getByText(/Checking which \\cite keys/)).toBeInTheDocument()
    await waitFor(() => expect(confirm.getByRole('button', { name: 'Move' })).toBeEnabled())
    fireEvent.click(confirm.getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(gateway.drafts.get('d2')!.projectId).toBe('proj1'))
    expect(patches()).toEqual(['PATCH /author/drafts/d2'])
    expect(await screen.findByText(`${SEMINAR} moved to ${THESIS}`)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: `Move ${SEMINAR} to…` })).toBeNull())
  })

  test('a project → Unsorted: warns about the keys only its .bib has, then sends "" (the gateway’s Unsorted)', async () => {
    renderLibrary('proj1')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${THESIS} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Unsorted' }))
    const confirm = within(screen.getByRole('dialog', { name: `Move ${THESIS}` }))
    expect(await confirm.findByRole('status')).toHaveTextContent(/\\cite\{khattab2020\}/)
    fireEvent.click(confirm.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(gateway.drafts.get('d1')!.projectId).toBeNull())
    await waitFor(() => expect(screen.queryByRole('button', { name: `Move ${THESIS} to…` })).toBeNull())
  })

  test('Unsorted → a new project: "New project…" opens the dialog with the draft ticked', async () => {
    renderLibrary('unsorted')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${SEMINAR} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'New project…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    expect(await dialog.findByRole('checkbox', { name: SEMINAR })).toBeChecked()
    expect(dialog.queryByRole('button', { name: /Import/ })).toBeNull()
    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Seminar' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Seminar created with 1 draft')).toBeInTheDocument()
    const seminar = [...gateway.projects.values()].find((p) => p.name === 'Seminar')!
    expect(gateway.drafts.get('d2')!.projectId).toBe(seminar.id)
  })

  test('the notice is still there on the new project’s page, as the app opens it', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    function App() {
      const [project, setProject] = useState<string | null>(null)
      return <Library projectId={project} onOpenProject={setProject} onOpenEditor={vi.fn()} />
    }
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    fireEvent.click(await dialog.findByRole('checkbox', { name: SEMINAR }))
    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Seminar' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('heading', { name: 'Seminar' })).toBeInTheDocument()
    expect(screen.getByText('Seminar created with 1 draft')).toBeInTheDocument()
  })

  test('a double click on Move sends one move', async () => {
    renderLibrary('unsorted')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${SEMINAR} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: THESIS }))
    const move = within(screen.getByRole('dialog', { name: `Move ${SEMINAR}` })).getByRole('button', { name: 'Move' })
    await waitFor(() => expect(move).toBeEnabled()) // once the .bib files to compare are in
    fireEvent.click(move)
    fireEvent.click(move)
    await waitFor(() => expect(gateway.drafts.get('d2')!.projectId).toBe('proj1'))
    expect(patches()).toEqual(['PATCH /author/drafts/d2'])
  })

  test('Cancel in the confirm moves nothing', async () => {
    renderLibrary('unsorted')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${SEMINAR} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: THESIS }))
    fireEvent.click(within(screen.getByRole('dialog', { name: `Move ${SEMINAR}` })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(patches()).toEqual([])
  })
})
