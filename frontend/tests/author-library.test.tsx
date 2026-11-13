/**
 * The Author Library (Figma 597:3631) and a project's detail (597:4404) against the fake
 * gateway: cards from the project's .bib and checks, the attention rows and their actions,
 * saved sources, and the per-draft check history with "Compare vN with vN-1".
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { checkedAtLabel } from '../src/lib/author'
import { Library } from '../src/roles/author/screens/Library'
import { Toaster } from '../src/components/Toaster'
import { installFakeGateway, markSaved, runCheck, type FakeGateway } from './fakeAuthorGateway'
import { MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis'

// Sonner keeps its toasts in a module-level store, and the next test's Toaster would show the
// ones still up: dismiss them so each test starts with none. Only the files that mount a
// Toaster do this, since importing sonner adds its stylesheet to the page and slows queries.
afterEach(() => toast.dismiss())

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><Toaster />{ui}</QueryClientProvider>)
}

function renderLibrary(projectId: string | null = null) {
  const onOpenProject = vi.fn()
  const onOpenEditor = vi.fn()
  const view = renderWithQuery(<Library projectId={projectId} onOpenProject={onOpenProject} onOpenEditor={onOpenEditor} />)
  return { ...view, onOpenProject, onOpenEditor }
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
  test('a project with one checked draft and one never checked is not all green', async () => {
    gateway = installFakeGateway({ files: [{ name: 'related-work.tex', content: RELATED_WORK_TEX }], prechecked: false, verdictFor: () => ({ verdict: 'supports', passage: 'all good', page: 1 }) })
    gateway.projects.get('proj1')!.bib = { name: 'main.bib', content: MAIN_BIB }
    gateway.drafts.get('d2')!.files = [{ name: 'note.tex', kind: 'tex', content: 'Fusion~\\cite{khattab2020}.' }]
    gateway.drafts.get('d1')!.files = [{ name: 'a.tex', kind: 'tex', content: 'One~\\cite{khattab2020}.' }]
    runCheck(gateway, 'd1')
    renderLibrary()
    const bar = await screen.findByRole('img', { name: /1 supported/ })
    expect(bar.getAttribute('aria-label')).toContain('1 not checked')
    expect(bar.children).toHaveLength(2)
    expect(screen.getByText(/1 not checked/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText(/all supported/)).not.toBeInTheDocument()
    // Long rows truncate rather than widen the page on a phone; a browser measures the rest.
    expect(screen.getByRole('heading', { name: 'Needs attention' }).closest('.grid')).toHaveClass('grid-cols-[minmax(0,1fr)]')
  })

  test('lists the project card with its .bib stats, the unsorted card, attention rows and saved sources', async () => {
    renderLibrary()
    const card = (await screen.findByRole('button', { name: 'Open Related work — thesis ch.2' })).parentElement!
    expect(card).toHaveTextContent('main.bib · 7 entries · 0 cited · 3 need work')
    expect(card).toHaveTextContent(/Checked/)
    expect(screen.getByRole('button', { name: /Unsorted sources/ })).toHaveAccessibleName(/1 draft in no project/)

    const attention = within(screen.getByRole('heading', { name: 'Needs attention' }).closest('div')!.parentElement!)
    expect(attention.getByText('\\cite{khattab2020} contradicts a claim in Related work — thesis ch.2')).toBeInTheDocument()
    expect(attention.getByText('nguyen2016 · no DOI or PDF')).toBeInTheDocument()
    expect(attention.getByText('karpukhin2020 · in main.bib')).toBeInTheDocument()
    expect(screen.getByText('No saved sources')).toBeInTheDocument()
  })

  test('an attention row with no file or line opens the draft at its default file', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await real(input, init)
      if (!String(input).endsWith('/author/library')) return response
      const library = await response.json()
      for (const row of library.attention) {
        delete row.file
        delete row.line
      }
      return new Response(JSON.stringify(library), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const { onOpenEditor } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Open draft' }))
    expect(onOpenEditor).toHaveBeenCalledWith('d1', undefined, undefined)
  })

  test('a contradicted citation opens its draft at the \\cite; Remove deletes the entry after a confirm', async () => {
    const { onOpenEditor } = renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Open draft' }))
    const cited = [...gateway.checks.values()].find((c) => c.draftId === 'd1')!.citations.find((c) => c.verdict === 'refutes')!
    expect(onOpenEditor).toHaveBeenCalledWith('d1', cited.file, cited.line)
    expect(cited.line).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Find a source/ })).not.toBeInTheDocument()

    // Cancel keeps the entry; Remove in the dialog deletes it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(gateway.calls).not.toContain('DELETE /author/projects/proj1/bib/karpukhin2020')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove karpukhin2020 from the .bib?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(gateway.calls).toContain('DELETE /author/projects/proj1/bib/karpukhin2020'))
    await waitFor(() => expect(screen.queryByText('karpukhin2020 · in main.bib')).not.toBeInTheDocument())
    expect(await screen.findByText('karpukhin2020 removed')).toBeInTheDocument()
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
    renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete PLAID' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete “PLAID”?' })).getByRole('button', { name: 'Delete source' }))
    await waitFor(() => expect(gateway.calls).toContain('DELETE /author/sources/src9'))
    await waitFor(() => expect(screen.queryByText(/Santhanam et al\. \(2022\) · PLAID/)).not.toBeInTheDocument())
    expect(gateway.projects.get('proj1')!.bib!.content).toBe(MAIN_BIB)
  })

  test('a saved source in no project picks its project from a menu when there are several', async () => {
    const t = new Date().toISOString()
    gateway.projects.set('proj2', { id: 'proj2', name: 'Grant aims', bib: { name: 'aims.bib', content: '' }, pdfs: {}, created: t, updated: t })
    gateway.sources.set('src9', {
      id: 'src9', projectId: null, key: 'santhanam2022plaid', title: 'PLAID', authors: 'Santhanam et al.', authorsList: ['Keshav Santhanam'], year: 2022,
      venue: 'CIKM', doi: '', arxiv: '', url: '', identifier: '', openAccess: true, citedBy: null, bibtex: '@inproceedings{santhanam2022plaid,\n  title = {PLAID},\n}',
      inBib: false, bibName: null, savedAt: '', verdict: 'supports',
    })
    renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to .bib' }))
    const menu = screen.getByRole('menu', { name: "Add to which project's .bib" })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(
      expect.arrayContaining(['Related work — thesis ch.2', 'Grant aims']),
    )
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Grant aims' }))
    await waitFor(() => expect(gateway.calls).toContain('POST /author/sources/src9/add-to-bib'))
    expect(await screen.findByText('santhanam2022plaid added to Grant aims')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Open Related work — thesis ch.2' }))
    expect(onOpenProject).toHaveBeenCalledWith('proj1')

    // What AuthorApp does with that id: the same Library, now on the project's detail.
    cleanup()
    renderLibrary('proj1')
    expect(await screen.findByRole('heading', { name: 'Related work — thesis ch.2' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Drafts in this project' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Check history · Related work/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^← Library/ })).toBeInTheDocument()
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
    const drafts = within(screen.getByRole('list', { name: 'Drafts in this project' })).getAllByRole('listitem')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toHaveTextContent('v4')

    const history = within(screen.getByRole('heading', { name: /Check history · Related work/ }).closest('div')!.parentElement!)
    expect(history.getByText((_, el) => el?.tagName === 'P' && /^v4 · checked/.test(el.textContent ?? ''))).toBeInTheDocument()
    expect(history.getByText((_, el) => el?.tagName === 'P' && /^v3 · checked/.test(el.textContent ?? ''))).toBeInTheDocument()
    expect(screen.getByText('Since v3')).toBeInTheDocument()
    expect(screen.getByText('+0 citations · 3 issues fixed · 0 new issues')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Compare v4 with v3' }))
    expect(await screen.findByText(/v4 vs v3 · 3 changes/)).toBeInTheDocument()
    expect(screen.getAllByText('fixed')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(onOpenEditor).toHaveBeenCalledWith('d1')
    fireEvent.click(screen.getByRole('button', { name: /^← Library/ }))
  })

  test('a re-check without edits says so instead of offering a compare of the same version', async () => {
    runCheck(gateway, 'd1') // nothing edited since the seeded check
    renderLibrary('proj1')
    await screen.findByRole('heading', { name: /Check history · Related work/ })
    expect(screen.getByText('No changes since the previous check')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Compare v3 with v3/ })).not.toBeInTheDocument()
    expect(gateway.drafts.get('d1')!.version).toBe(3)
  })

  test('checks of the same version tell apart: each history row gives its time, the relative one in its tooltip (#721)', async () => {
    // three checks of v3, the way the e2e seed made them: minutes apart, hours ago
    runCheck(gateway, 'd1')
    runCheck(gateway, 'd1')
    const runs = [...gateway.checks.values()].filter((c) => c.draftId === 'd1')
    expect(runs).toHaveLength(3)
    runs.forEach((run, i) => {
      run.startedAt = run.finishedAt = new Date(2020, 10, 8, 13, 27 + i * 2).toISOString()
    })
    renderLibrary('proj1')
    await screen.findByRole('heading', { name: /Check history · Related work/ })
    for (const minute of ['27', '29', '31']) {
      const time = screen.getByText(`checked 13:${minute}, 8 Nov 2020`)
      expect(time.tagName).toBe('TIME')
      expect(time).toHaveAttribute('title', expect.stringMatching(/^checked \d+ days ago$/))
      expect(time.closest('p')).toHaveTextContent(`v3 · checked 13:${minute}, 8 Nov 2020`)
    }
  })

  test('checkedAtLabel: relative within the hour (exact in the tooltip), exact after, the year only when not this one', () => {
    const now = new Date(2026, 10, 8, 15, 0).getTime()
    expect(checkedAtLabel(new Date(2026, 10, 8, 14, 48).toISOString(), now)).toEqual({ text: 'checked 12 min ago', title: 'checked 14:48, 8 Nov' })
    expect(checkedAtLabel(new Date(2026, 10, 8, 13, 5).toISOString(), now)).toEqual({ text: 'checked 13:05, 8 Nov', title: 'checked 2 h ago' })
    expect(checkedAtLabel(new Date(2025, 0, 2, 9, 7).toISOString(), now).text).toBe('checked 09:07, 2 Jan 2025')
    // a time that does not parse is no "checked NaN:NaN, NaN undefined"
    expect(checkedAtLabel('not a date', now)).toEqual({ text: 'not checked yet', title: '' })
    expect(checkedAtLabel('', now).text).not.toMatch(/NaN|undefined/)
  })

  test('the check history sits below the drafts at full width, not in a column beside them (#721)', async () => {
    renderLibrary('proj1')
    // the heading's CardHead, then its Card
    const history = (await screen.findByRole('heading', { name: /Check history · Related work/ })).parentElement!.parentElement!
    const drafts = screen.getByRole('list', { name: 'Drafts in this project' })
    const both = history.parentElement!
    expect(both).toContainElement(drafts)
    expect(both).toHaveClass('flex', 'flex-col')
    expect(both.className).not.toMatch(/grid-cols/)
    // the drafts come first
    expect(drafts.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('"unsorted" shows the drafts in no project and only the sources saved to no project', async () => {
    gateway.sources.set('in-project', { id: 'in-project', projectId: 'proj1', key: 'formal2021', title: 'SPLADE v2', authors: 'Formal et al.', authorsList: ['Thibault Formal'], year: 2021, venue: '', doi: '', arxiv: '', url: '', identifier: 'arxiv:2109.10086', openAccess: true, citedBy: 1, bibtex: '', inBib: false, bibName: null, savedAt: '2026-09-27T00:00:00Z' })
    renderLibrary('unsorted')
    expect(await screen.findByRole('heading', { level: 1, name: 'Unsorted sources' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Drafts in no project' })).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('No unsorted sources')).toBeInTheDocument()
    expect(screen.queryByText(/SPLADE v2/)).not.toBeInTheDocument()
    expect(gateway.calls).toContain('GET /author/sources?project=')
    // "View check history" on Home lands here for a draft in no project: its history shows.
    const unfiled = [...gateway.drafts.values()].find((d) => !d.projectId)!
    expect(screen.getByRole('heading', { name: `Check history · ${unfiled.title}` })).toBeInTheDocument()
    expect(gateway.calls).toContain(`GET /author/drafts/${unfiled.id}/checks`)
  })

  test('a gateway error shows the message and a retry', async () => {
    gateway.fetch.mockRejectedValue(new Error('the gateway is down'))
    renderLibrary()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your library could not load')
    expect(screen.getByRole('alert')).toHaveTextContent('the gateway is down')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
