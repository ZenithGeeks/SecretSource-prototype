/**
 * The Author Library (Figma 597:3631) and a project's detail (597:4404) against the fake
 * gateway: cards from the project's .bib and checks, the attention rows and their actions,
 * saved sources, and the per-draft check history with "Compare vN with vN-1".
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Library } from '../src/roles/author/screens/Library'
import { installFakeGateway, runCheck, type FakeGateway } from './fakeAuthorGateway'
import { MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis'

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderLibrary(projectId: string | null = null) {
  const onOpenProject = vi.fn()
  const onOpenEditor = vi.fn()
  const onFindSource = vi.fn()
  const onOpenDraft = vi.fn()
  const view = renderWithQuery(
    <Library projectId={projectId} onOpenProject={onOpenProject} onOpenEditor={onOpenEditor} onFindSource={onFindSource} onOpenDraft={onOpenDraft} />,
  )
  return { ...view, onOpenProject, onOpenEditor, onFindSource, onOpenDraft }
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
    expect(screen.getByText('No saved sources yet')).toBeInTheDocument()
  })

  test('Replace opens Find a source for the citation; Remove deletes the entry after a confirm', async () => {
    const { onFindSource } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
    expect(onFindSource).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'd1', citationId: expect.any(String) }))

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

  test('Import .bib creates a project on the gateway and opens it', async () => {
    const { onOpenProject } = renderLibrary()
    await screen.findByRole('button', { name: /Import \.bib/ })
    const input = screen.getByLabelText('Import a .bib or an Overleaf .zip') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['@misc{a, title={A}}'], 'refs.bib', { type: 'text/plain' })] } })
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(expect.stringMatching(/^proj/)))
    expect(gateway.calls).toContain('POST /author/projects/import')
  })

  test('the project detail lists its drafts and the check history with a compare', async () => {
    // a second, later check on a newer version, with the contradiction fixed
    gateway.drafts.get('d1')!.version = 4
    gateway.verdictFor = (key) => (key === 'nguyen2016' ? { verdict: 'unavailable', reason: 'no-open-access', message: 'x' } : { verdict: 'supports', passage: 'ok', page: 1 })
    runCheck(gateway, 'd1')

    const { onOpenEditor } = renderLibrary('proj1')
    expect(await screen.findByRole('heading', { name: 'Related work — thesis ch.2' })).toBeInTheDocument()
    expect(screen.getByText('main.bib · 7 entries · 0 cited · all supported')).toBeInTheDocument()
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

  test('"unsorted" shows the drafts in no project and an empty sources list', async () => {
    renderLibrary('unsorted')
    expect(await screen.findByRole('heading', { level: 1, name: 'Unsorted sources' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Drafts in no project' })).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('No unsorted sources')).toBeInTheDocument()
  })

  test('a gateway error shows the message and a retry', async () => {
    gateway.fetch.mockRejectedValue(new Error('the gateway is down'))
    renderLibrary()
    expect(await screen.findByText(/Could not load your library: the gateway is down/)).toBeInTheDocument()
  })
})
