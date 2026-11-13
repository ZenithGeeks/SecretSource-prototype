/**
 * #721: moving drafts between projects. "+ New project" can take existing drafts along; each
 * draft row in Unsorted and in a project has "Move to…" (another project, Unsorted, or a new
 * project). All of it goes through the gateway's own move, PATCH /drafts/{id} with the
 * project's id ("" for Unsorted), and warns about cited keys only the old project's .bib holds.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { keysLostByMove } from '../src/lib/latexProject'
import { NewProjectWithDrafts } from '../src/roles/author/components/MoveDraft'
import { Library } from '../src/roles/author/screens/Library'
import type { Draft, ProjectFile } from '../src/types/draftCheck'
import { Toaster } from '../src/components/Toaster'
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
  render(<QueryClientProvider client={queryClient}><Toaster />{ui}</QueryClientProvider>)
  return { onOpenProject }
}

const patches = () => gateway.calls.filter((c) => c.startsWith('PATCH /author/drafts/'))

/** Requests that `match` answer 503 while `down`, after `wait` when there is one; `asked` counts them. */
function refuse(match: (method: string, url: string) => boolean) {
  const real = gateway.fetch.getMockImplementation()!
  const state: { down: boolean; asked: number; wait?: Promise<void> } = { down: true, asked: 0 }
  gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (!match((init?.method ?? 'GET').toUpperCase(), String(input))) return real(input, init)
    state.asked += 1
    const answer = () => (state.down ? new Response(JSON.stringify({ detail: 'the gateway is down' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) : real(input, init))
    return state.wait ? state.wait.then(answer) : Promise.resolve(answer())
  })
  return state
}
const projectDown = (id: string) => refuse((method, url) => method === 'GET' && url.endsWith(`/author/projects/${id}`))
const moveDown = (id: string) => refuse((method, url) => method === 'PATCH' && url.endsWith(`/author/drafts/${id}`))

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
        <Toaster />
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

  test('a .bib that cannot be read blocks the move instead of passing as "nothing lost"; Retry reads it', async () => {
    const t = new Date().toISOString()
    gateway.projects.set('proj2', { id: 'proj2', name: 'Chapter 3', bib: { name: 'refs.bib', content: '' }, pdfs: {}, created: t, updated: t })
    const target = projectDown('proj2')
    renderLibrary('proj1')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${THESIS} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Chapter 3' }))
    const confirm = within(screen.getByRole('dialog', { name: `Move ${THESIS}` }))
    const move = confirm.getByRole('button', { name: 'Move' })
    expect(await confirm.findByRole('alert')).toHaveTextContent('Couldn’t check which \\cite keys the move leaves behind.')
    // not the silence of "no keys lost", and no way to move past it
    expect(confirm.queryByRole('status')).toBeNull()
    expect(move).toBeDisabled()
    expect(target.asked).toBe(1)

    // still down: Retry asks again, and the answer is the same
    fireEvent.click(confirm.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(target.asked).toBe(2))
    expect(await confirm.findByRole('alert')).toHaveTextContent('Couldn’t check')
    expect(move).toBeDisabled()

    target.down = false
    fireEvent.click(confirm.getByRole('button', { name: 'Retry' }))
    expect(await confirm.findByRole('status')).toHaveTextContent(/\\cite\{khattab2020\}.*defined only in Related work — thesis ch\.2’s main\.bib/)
    expect(confirm.queryByRole('alert')).toBeNull()
    expect(move).toBeEnabled()
    expect(target.asked).toBe(3)
    expect(patches()).toEqual([])
    fireEvent.click(move)
    await waitFor(() => expect(gateway.drafts.get('d1')!.projectId).toBe('proj2'))
  })

  test('"+ New project" with a draft whose .bib cannot be read makes no project until Retry reads it', async () => {
    const source = projectDown('proj1')
    const { onOpenProject } = renderLibrary(null)
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    fireEvent.click(await dialog.findByRole('checkbox', { name: THESIS }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Couldn’t check which \\cite keys the move leaves behind.')
    expect(dialog.queryByRole('status')).toBeNull()

    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Chapter 3' } })
    const form = dialog.getByRole('button', { name: 'Create project' }).closest('form')!
    fireEvent.submit(form)
    expect(await dialog.findByText('Couldn’t check the chosen drafts’ .bib files. Retry the check, or untick those drafts.')).toBeInTheDocument()
    expect(gateway.calls.filter((c) => c === 'POST /author/projects')).toHaveLength(0)
    expect(patches()).toEqual([])

    source.down = false
    fireEvent.click(dialog.getByRole('button', { name: 'Retry' }))
    expect(await dialog.findByRole('status')).toHaveTextContent(/\\cite\{khattab2020\}/)
    fireEvent.submit(form)
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledTimes(1))
    expect(gateway.drafts.get('d1')!.projectId).toBe(onOpenProject.mock.calls[0][0])
    expect(await screen.findByText('Chapter 3 created with 1 draft')).toBeInTheDocument()
  })

  test('"+ New project": Create waits for the .bib check, an unticked draft stays, and a refusal is said', async () => {
    const source = projectDown('proj1')
    source.down = false
    let release = () => {}
    source.wait = new Promise<void>((resolve) => (release = resolve))
    const create = refuse((method, url) => method === 'POST' && url.endsWith('/author/projects'))
    const { onOpenProject } = renderLibrary(null)
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    fireEvent.click(await dialog.findByRole('checkbox', { name: THESIS }))
    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Empty' } })
    const form = dialog.getByRole('button', { name: 'Create project' }).closest('form')!
    fireEvent.submit(form)
    expect(await dialog.findByText(/Still checking the chosen drafts’ \.bib files/)).toBeInTheDocument()
    expect(create.asked).toBe(0)
    release()
    expect(await dialog.findByRole('status')).toHaveTextContent(/khattab2020/)

    // unticked again: nothing to warn about, nothing to move
    fireEvent.click(dialog.getByRole('checkbox', { name: THESIS }))
    expect(dialog.queryByRole('status')).toBeNull()
    fireEvent.submit(form)
    expect(await dialog.findByText(/the gateway is down/)).toBeInTheDocument()
    expect(onOpenProject).not.toHaveBeenCalled()

    create.down = false
    fireEvent.submit(form)
    expect(await screen.findByText('Empty created')).toBeInTheDocument()
    expect(gateway.drafts.get('d1')!.projectId).toBe('proj1')
    expect(patches()).toEqual([])
  })

  test('"+ New project": a draft that could not be moved is named, and the project is still made', async () => {
    moveDown('d2')
    const { onOpenProject } = renderLibrary(null)
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    fireEvent.click(await dialog.findByRole('checkbox', { name: SEMINAR }))
    fireEvent.change(dialog.getByLabelText('Project name'), { target: { value: 'Chapter 3' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText(/^Chapter 3 created; could not move Seminar paper \(CPE\) \(.*the gateway is down.*\)$/)).toBeInTheDocument()
    expect(onOpenProject).toHaveBeenCalledTimes(1)
    expect(gateway.drafts.get('d2')!.projectId).toBeNull()
  })

  test('the dialog on its own: a draft handed in is ticked before the list loads, and one deleted meanwhile is left out', async () => {
    const handed = (await (await gateway.fetch('/api/author/drafts/d2')).json()) as Draft
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const onCreated = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <Toaster />
        <NewProjectWithDrafts initial={[handed]} onCancel={vi.fn()} onCreated={onCreated} />
      </QueryClientProvider>,
    )
    const dialog = within(screen.getByRole('dialog', { name: 'New project' }))
    expect(await dialog.findByRole('checkbox', { name: SEMINAR })).toBeChecked()
    fireEvent.click(dialog.getByRole('checkbox', { name: THESIS }))
    expect(await dialog.findByRole('status')).toHaveTextContent(/khattab2020/)
    // deleted in another tab: it leaves the list, the warning and the move
    gateway.drafts.delete('d1')
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => expect(dialog.queryByRole('checkbox', { name: THESIS })).toBeNull())
    expect(dialog.queryByRole('status')).toBeNull()
    fireEvent.click(dialog.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.any(String)))
    expect(await screen.findByText('Untitled project created with 1 draft')).toBeInTheDocument()
    expect(patches()).toEqual(['PATCH /author/drafts/d2'])
  })

  test('a move the gateway refuses says so, and the draft stays where it was', async () => {
    moveDown('d2')
    renderLibrary('unsorted')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${SEMINAR} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: THESIS }))
    const move = within(screen.getByRole('dialog', { name: `Move ${SEMINAR}` })).getByRole('button', { name: 'Move' })
    await waitFor(() => expect(move).toBeEnabled())
    fireEvent.click(move)
    const failure = await screen.findByText(/^Could not move Seminar paper \(CPE\) \(.*the gateway is down.*\)$/)
    // SCRUM-533: a failure is an error toast (its red icon), never a success one.
    expect(failure.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error')
    expect(gateway.drafts.get('d2')!.projectId).toBeNull()
    expect(screen.getByRole('button', { name: `Move ${SEMINAR} to…` })).toBeInTheDocument()
  })

  test('Esc or a click elsewhere closes the menu and the confirm, but not a move on its way; two clicks at once send one move', async () => {
    // in the project, with its own refs.bib: leaving loses no key
    gateway.drafts.get('d2')!.projectId = 'proj1'
    const patch = moveDown('d2')
    patch.down = false
    renderLibrary('proj1')
    const opener = await screen.findByRole('button', { name: `Move ${SEMINAR} to…` })
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'a' })
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Unsorted' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Unsorted' }))
    const confirm = within(screen.getByRole('dialog', { name: `Move ${SEMINAR}` }))
    const move = confirm.getByRole('button', { name: 'Move' })
    await waitFor(() => expect(move).toBeEnabled())
    expect(confirm.queryByRole('status')).toBeNull()
    let release = () => {}
    patch.wait = new Promise<void>((resolve) => (release = resolve))
    // both clicks before React renders the button disabled
    act(() => {
      fireEvent.click(move)
      fireEvent.click(move)
    })
    expect(await confirm.findByRole('button', { name: 'Moving…' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(screen.getByRole('dialog', { name: `Move ${SEMINAR}` })).toBeInTheDocument()
    release()
    await waitFor(() => expect(gateway.drafts.get('d2')!.projectId).toBeNull())
    expect(patch.asked).toBe(1)
  })

  test('Cancel in "New project…" from a draft’s menu moves nothing and closes the dialog', async () => {
    renderLibrary('unsorted')
    fireEvent.click(await screen.findByRole('button', { name: `Move ${SEMINAR} to…` }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'New project…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New project' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(gateway.calls.filter((c) => c === 'POST /author/projects')).toHaveLength(0)
    expect(patches()).toEqual([])
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
