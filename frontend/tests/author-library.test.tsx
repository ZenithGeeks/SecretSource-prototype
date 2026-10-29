/**
 * The Author Library (Figma 597:3631) and a project's detail (597:4404) against the fake
 * gateway: cards from the project's .bib and checks, the attention rows and their actions,
 * saved sources, and the per-draft check history with "Compare vN with vN-1".
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Library } from '../src/roles/author/screens/Library'
import { installFakeGateway, markSaved, runCheck, type FakeGateway } from './fakeAuthorGateway'
import { MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderLibrary(projectId: string | null = null) {
  const onOpenProject = vi.fn()
  const onOpenEditor = vi.fn()
  const onOpenDraft = vi.fn()
  const view = renderWithQuery(<Library projectId={projectId} onOpenProject={onOpenProject} onOpenEditor={onOpenEditor} onOpenDraft={onOpenDraft} />)
  return { ...view, onOpenProject, onOpenEditor, onOpenDraft }
}

beforeEach(() => {
  // The project owns the .bib; the draft holds only the chapter (the shape an import makes).
  gateway = installFakeGateway({ files: [{ name: 'related-work.tex', content: RELATED_WORK_TEX }], prechecked: false })
  gateway.projects.get('proj1')!.bib = { name: 'main.bib', content: MAIN_BIB }
  gateway.drafts.get('d2')!.projectId = null
  runCheck(gateway, 'd1')
  runCheck(gateway, 'd2')
})

afterEach(() => vi.unstubAllGlobals())

describe('Author Library', () => {
  test('lists the project card with its .bib stats, the unsorted card, attention rows and saved sources', async () => {
    renderLibrary()
    const card = await screen.findByRole('button', { name: /Related work — thesis ch\.2/ })
    expect(card).toHaveTextContent('main.bib · 7 entries · 0 cited · 3 need work')
    expect(card).toHaveTextContent(/Checked/)
    expect(screen.getByRole('button', { name: /Unsorted sources/ })).toHaveTextContent('1 draft in no project')

    const attention = within(screen.getByRole('heading', { name: 'Needs attention' }).closest('div')!.parentElement!)
    expect(attention.getByText('\\cite{khattab2020} contradicts a claim in Related work — thesis ch.2')).toBeInTheDocument()
    expect(attention.getByText('nguyen2016 · no DOI or PDF')).toBeInTheDocument()
    expect(attention.getByText('karpukhin2020 · in main.bib')).toBeInTheDocument()
    expect(screen.getByText('No saved sources')).toBeInTheDocument()
  })

  test('a contradicted citation opens its draft on Check a draft; Remove deletes the entry after a confirm', async () => {
    const { onOpenDraft } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Open draft' }))
    expect(onOpenDraft).toHaveBeenCalledWith('d1')
    expect(screen.queryByRole('button', { name: /Find a source/ })).not.toBeInTheDocument()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(gateway.calls).toContain('DELETE /author/projects/proj1/bib/karpukhin2020'))
    await waitFor(() => expect(screen.queryByText('karpukhin2020 · in main.bib')).not.toBeInTheDocument())
    expect(await screen.findByRole('status')).toHaveTextContent('karpukhin2020 removed')
  })

  test('a saved source can be added to the project .bib, after which it offers Insert \\cite', async () => {
    gateway.sources.set('src9', {
      id: 'src9', projectId: 'proj1', key: 'santhanam2022plaid', title: 'PLAID', authors: 'Santhanam et al.', authorsList: ['Keshav Santhanam'], year: 2022,
      venue: 'CIKM', doi: '', arxiv: '', url: '', identifier: '', openAccess: true, citedBy: null, bibtex: '@inproceedings{santhanam2022plaid,\n  title = {PLAID},\n}',
      inBib: false, bibName: 'main.bib', savedAt: '', verdict: 'supports',
    })
    renderLibrary()
    expect(await screen.findByText(/Santhanam et al\. \(2022\) · PLAID/)).toBeInTheDocument()
    expect(screen.getByText('Supports 1 claim · not in main.bib yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to .bib' }))
    await waitFor(() => expect(gateway.calls).toContain('POST /author/sources/src9/add-to-bib'))
    expect(await screen.findByRole('button', { name: 'Insert \\cite' })).toBeInTheDocument()
    expect(gateway.projects.get('proj1')!.bib!.content).toContain('santhanam2022plaid')
  })

  test('a saved source has a delete button that removes only the source, not the .bib entry', async () => {
    gateway.sources.set('src9', {
      id: 'src9', projectId: 'proj1', key: 'santhanam2022plaid', title: 'PLAID', authors: 'Santhanam et al.', authorsList: ['Keshav Santhanam'], year: 2022,
      venue: 'CIKM', doi: '', arxiv: '', url: '', identifier: '', openAccess: true, citedBy: null, bibtex: '@inproceedings{santhanam2022plaid,\n  title = {PLAID},\n}',
      inBib: false, bibName: 'main.bib', savedAt: '', verdict: 'supports',
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete PLAID' }))
    expect(confirm).toHaveBeenCalled()
    await waitFor(() => expect(gateway.calls).toContain('DELETE /author/sources/src9'))
    await waitFor(() => expect(screen.queryByText(/Santhanam et al\. \(2022\) · PLAID/)).not.toBeInTheDocument())
    expect(gateway.projects.get('proj1')!.bib!.content).toBe(MAIN_BIB)
  })

  test('Import .bib creates a project on the gateway and opens it', async () => {
    const { onOpenProject } = renderLibrary()
    await screen.findByRole('button', { name: /Import \.bib/ })
    const input = screen.getByLabelText('Import a .bib or an Overleaf .zip') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['@misc{a, title={A}}'], 'refs.bib', { type: 'text/plain' })] } })
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(expect.stringMatching(/^proj/)))
    expect(gateway.calls).toContain('POST /author/projects/import')
  })

  test('clicking a project card asks to open it, and the project id then shows the detail view', async () => {
    const { onOpenProject } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: /Related work — thesis ch\.2/ }))
    expect(onOpenProject).toHaveBeenCalledWith('proj1')

    // What AuthorApp does with that id: the same Library, now on the project's detail.
    cleanup()
    renderLibrary('proj1')
    expect(await screen.findByRole('heading', { name: 'Related work — thesis ch.2' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Drafts in this project' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Check history · Related work/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Library' })).toBeInTheDocument()
  })

  test('the project detail lists its drafts and the check history with a compare', async () => {
    // a second, later check on a newer version, with the contradiction fixed
    const d1 = gateway.drafts.get('d1')!
    d1.files[0].content += '\n% revised after the first check\n'
    d1.version = 4
    markSaved(d1)
    gateway.verdictFor = (key) => (key === 'nguyen2016' ? { verdict: 'unavailable', reason: 'no-open-access', message: 'x' } : { verdict: 'supports', passage: 'ok', page: 1 })
    runCheck(gateway, 'd1')

    const { onOpenEditor } = renderLibrary('proj1')
    expect(await screen.findByRole('heading', { name: 'Related work — thesis ch.2' })).toBeInTheDocument()
    // nguyen2016 has no free copy (unavailable) and one \cite key is not in the .bib (not
    // checked): neither is supported, so the project is not "all supported" (#727)
    expect(screen.getByText('main.bib · 7 entries · 0 cited · 1 unavailable · 1 not checked')).toBeInTheDocument()
    const drafts = within(screen.getByRole('list', { name: 'Drafts in this project' })).getAllByRole('button')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toHaveTextContent('v4')

    const history = within(screen.getByRole('heading', { name: /Check history · Related work/ }).closest('div')!.parentElement!)
    expect(history.getByText(/^v4 · checked/)).toBeInTheDocument()
    expect(history.getByText(/^v3 · checked/)).toBeInTheDocument()
    expect(screen.getByText('Since v3')).toBeInTheDocument()
    expect(screen.getByText('+0 citations · 3 issues fixed · 0 new issues')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Compare v4 with v3' }))
    expect(await screen.findByText(/v4 vs v3 · 3 changes/)).toBeInTheDocument()
    expect(screen.getAllByText('fixed')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(onOpenEditor).toHaveBeenCalledWith('d1')
    fireEvent.click(screen.getByRole('button', { name: '← Library' }))
  })

  test('a re-check without edits says so instead of offering a compare of the same version', async () => {
    runCheck(gateway, 'd1') // nothing edited since the seeded check
    renderLibrary('proj1')
    await screen.findByRole('heading', { name: /Check history · Related work/ })
    expect(screen.getByText('No changes since the previous check')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Compare v3 with v3/ })).not.toBeInTheDocument()
    expect(gateway.drafts.get('d1')!.version).toBe(3)
  })

  test('"unsorted" shows the drafts in no project and only the sources saved to no project', async () => {
    gateway.sources.set('in-project', { id: 'in-project', projectId: 'proj1', key: 'formal2021', title: 'SPLADE v2', authors: 'Formal et al.', authorsList: ['Thibault Formal'], year: 2021, venue: '', doi: '', arxiv: '', url: '', identifier: 'arxiv:2109.10086', openAccess: true, citedBy: 1, bibtex: '', inBib: false, bibName: null, savedAt: '2026-09-27T00:00:00Z' })
    renderLibrary('unsorted')
    expect(await screen.findByRole('heading', { level: 1, name: 'Unsorted sources' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Drafts in no project' })).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('No unsorted sources')).toBeInTheDocument()
    expect(screen.queryByText(/SPLADE v2/)).not.toBeInTheDocument()
    expect(gateway.calls).toContain('GET /author/sources?project=')
    // "View check history" on Check a draft lands here for a draft in no project: its history shows.
    const unfiled = [...gateway.drafts.values()].find((d) => !d.projectId)!
    expect(screen.getByRole('heading', { name: `Check history · ${unfiled.title}` })).toBeInTheDocument()
    expect(gateway.calls).toContain(`GET /author/drafts/${unfiled.id}/checks`)
  })

  test('a gateway error shows the message and a retry', async () => {
    gateway.fetch.mockRejectedValue(new Error('the gateway is down'))
    renderLibrary()
    expect(await screen.findByText(/Could not load your library: the gateway is down/)).toBeInTheDocument()
  })
})
