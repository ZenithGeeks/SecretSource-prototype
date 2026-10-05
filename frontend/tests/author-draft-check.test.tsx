/**
 * Author Home — Check a draft — against the fake gateway (tests/fakeAuthorGateway.ts): the
 * counts and warnings come from the seeded thesis chapter, and every action ends in the
 * request the real gateway would get. What the screen changed is still there after it
 * unmounts and mounts again, as after a page refresh.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { DraftCheck } from '../src/roles/author/screens/DraftCheck'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

let gateway: FakeGateway
let queryClient: QueryClient

function renderWithQuery(ui: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderDraftCheck(draftId: string | null = 'd1') {
  const onSelectDraft = vi.fn()
  const onOpenEditor = vi.fn()
  const onOpenHistory = vi.fn()
  const view = renderWithQuery(<DraftCheck draftId={draftId} onSelectDraft={onSelectDraft} onOpenEditor={onOpenEditor} onOpenHistory={onOpenHistory} />)
  return { ...view, onSelectDraft, onOpenEditor, onOpenHistory }
}

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

afterEach(() => vi.unstubAllGlobals())

describe('Author Check a draft', () => {
  test('shows the header counts, the parse warnings and the open issues from the gateway', async () => {
    renderDraftCheck()
    expect(await screen.findByRole('heading', { name: 'Check a draft' })).toBeInTheDocument()
    expect(await screen.findByText(/6 citations found · 3 need work/)).toBeInTheDocument()

    expect(await screen.findByText('5 warnings')).toBeInTheDocument()
    expect(screen.getByText('\\cite{liu2023} in related-work.tex L37')).toBeInTheDocument()
    expect(screen.getByText('santhanam2022 defined twice')).toBeInTheDocument()

    const rows = within(await screen.findByRole('list', { name: 'Citations' })).getAllByRole('button')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('source contradicts')
    expect(rows[0]).toHaveTextContent('\\cite{khattab2020} · khattab2020.pdf p.7')
    expect(screen.getByText('2 supported')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 of 3 issues/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })).toBeInTheDocument()
    expect(screen.getByText('“we leave compression of the embeddings to future work”')).toBeInTheDocument()
    expect(gateway.calls).toContain('GET /author/drafts/d1')
  })

  test('the pager cycles through open issues; "All" and "Low confidence" filter the rows', async () => {
    renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /1 of 3 issues/ }))
    expect(screen.getByRole('button', { name: /2 of 3 issues/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(within(screen.getByRole('list', { name: 'Citations' })).getAllByRole('button')).toHaveLength(8)

    fireEvent.click(screen.getByRole('button', { name: 'Low confidence' }))
    const low = within(screen.getByRole('list', { name: 'Citations' })).getAllByRole('button')
    expect(low).toHaveLength(1)
    expect(low[0]).toHaveTextContent('thakur2021')
  })

  test('"Override · add note" records the resolution on the gateway and survives a remount', async () => {
    const first = renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Override · add note/ }))
    fireEvent.change(screen.getByLabelText('Why you are keeping this citation'), { target: { value: 'Table 3 says so' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(screen.getByText(/2 need work/)).toBeInTheDocument())
    expect(gateway.calls.some((c) => /^PATCH \/author\/checks\/check\d+\/citations\//.test(c))).toBe(true)
    const check = [...gateway.checks.values()].find((c) => c.draftId === 'd1')!
    expect(check.citations.find((c) => c.resolution)?.resolution).toMatchObject({ kind: 'overridden', note: 'Table 3 says so' })

    // A fresh mount (a refresh) reads the same state back from the gateway.
    first.unmount()
    queryClient.clear()
    renderDraftCheck()
    expect(await screen.findByText(/2 need work/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /1 of 2 issues/ })).toBeInTheDocument()
  })

  test('warnings and "Fix in editor" open the editor at the file and line', async () => {
    const { onOpenEditor } = renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Duplicate key/ }))
    expect(onOpenEditor).toHaveBeenCalledWith({ draftId: 'd1', file: 'main.bib', line: expect.any(Number) })

    fireEvent.click(screen.getByRole('button', { name: 'Fix in editor' }))
    expect(onOpenEditor).toHaveBeenLastCalledWith({ draftId: 'd1', file: 'related-work.tex', line: 37 })
  })

  test('Your drafts switches drafts and "+ New draft" creates one on the gateway', async () => {
    const { onSelectDraft, onOpenEditor } = renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Seminar paper \(CPE\)/ }))
    expect(onSelectDraft).toHaveBeenCalledWith('d2')
    expect(screen.getByText('all supported')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ New draft' }))
    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledWith({ draftId: expect.stringMatching(/^draft/), file: 'main.tex', line: 1 }))
    expect(gateway.calls).toContain('POST /author/drafts')
  })

  test('a row names the source of a quoted passage even when no page is known, as the Evidence panel does', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: (key) =>
        key === 'khattab2020'
          ? { verdict: 'refutes', passage: 'we leave compression to future work', explanation: 'Deferred.' }
          : key === 'santhanam2022'
            ? { verdict: 'refutes', explanation: 'Nothing was quoted.' }
            : { verdict: 'supports', passage: 'all good', page: 1 },
    })
    renderDraftCheck()
    const list = await screen.findByRole('list', { name: 'Citations' })
    await waitFor(() => expect(within(list).getAllByRole('button').length).toBeGreaterThan(0))
    const notes = within(list)
      .getAllByRole('button')
      .map((row) => row.textContent ?? '')
    const quoted = notes.filter((note) => note.includes('\\cite{khattab2020}'))
    expect(quoted.length).toBeGreaterThan(0)
    for (const note of quoted) {
      expect(note).toContain('\\cite{khattab2020} · khattab2020.pdf')
      expect(note).not.toContain('p.')
      expect(note).not.toContain('no passage quoted')
    }
    const unquoted = notes.filter((note) => note.includes('\\cite{santhanam2022}'))
    expect(unquoted.length).toBeGreaterThan(0)
    for (const note of unquoted) expect(note).toContain('no passage quoted')
    expect(screen.getByText('“we leave compression to future work”')).toBeInTheDocument()
  })

  test('Re-check starts a run on the gateway and the new verdicts land', async () => {
    renderDraftCheck()
    await screen.findByText(/3 need work/)
    gateway.verdictFor = () => ({ verdict: 'supports', passage: 'all good', page: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(screen.getByText(/0 need work/)).toBeInTheDocument())
    expect(gateway.calls).toContain('POST /author/drafts/d1/check')
  })

  test('with no drafts the screen offers the three quick actions and an empty state', async () => {
    gateway = installFakeGateway({})
    renderDraftCheck(null)
    expect(await screen.findByText('No drafts yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload \.tex or \.zip/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Write a draft/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add bibliography/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Find a source/ })).not.toBeInTheDocument()
  })

  test('the evidence panel offers Upload source PDF and Override, and no search', async () => {
    renderDraftCheck()
    await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
    expect(screen.getByRole('button', { name: /Upload source PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Override · add note/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Find a replacement/ })).not.toBeInTheDocument()
    expect(gateway.calls.some((c) => c.includes('/author/search'))).toBe(false)
  })

  test('a draft that does not exist shows an honest message, not a crash', async () => {
    renderDraftCheck('gone')
    expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument()
  })

  test('a gateway that does not answer shows the error and a retry', async () => {
    gateway.fetch.mockRejectedValue(new Error('the gateway is down'))
    renderDraftCheck()
    expect(await screen.findByText(/Could not load your drafts: the gateway is down/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
