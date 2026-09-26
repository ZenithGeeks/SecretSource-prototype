/**
 * Find a source (Figma 597:3930) against the fake gateway: one search, chips filtering it on
 * the client, the top results verified against the sentence, and "Cite this" replacing the
 * citation it was opened for — or copying the \cite, honestly, when the clipboard refuses.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { FindASource } from '../src/roles/author/screens/FindASource'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderScreen(props: Partial<Parameters<typeof FindASource>[0]> = {}) {
  const onQueryChange = vi.fn()
  const onReplaced = vi.fn()
  renderWithQuery(<FindASource initialQuery="compressing token-level embeddings makes the index smaller" onQueryChange={onQueryChange} onReplaced={onReplaced} {...props} />)
  return { onQueryChange, onReplaced }
}

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
})

afterEach(() => vi.unstubAllGlobals())

describe('Find a source', () => {
  test('searches on mount, verifies the top results against the query and shows their passages', async () => {
    renderScreen()
    expect(await screen.findByText(/ColBERTv2: Effective and Efficient Retrieval/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My library (7)' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('source backs it')).toHaveLength(2), { timeout: 4000 })
    expect(screen.getByText('source contradicts')).toBeInTheDocument()
    expect(screen.getByText(/residual compression reduces the space footprint/)).toBeInTheDocument()
    expect(screen.getByText('best match')).toBeInTheDocument()
    expect(gateway.calls.filter((c) => c === 'POST /author/search/verify')).toHaveLength(3)
  })

  test('the scope chips filter the one cached answer', async () => {
    renderScreen()
    await screen.findByText(/PLAID/)
    fireEvent.click(screen.getByRole('button', { name: 'My library (7)' }))
    await waitFor(() => expect(screen.queryByText(/PLAID/)).not.toBeInTheDocument())
    expect(screen.getByText(/ColBERT: Efficient and Effective Passage Search/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open access' }))
    expect(await screen.findByText(/PLAID/)).toBeInTheDocument()
    expect(gateway.calls.filter((c) => c.startsWith('GET /author/search?'))).toHaveLength(1)
  })

  test('opened for a citation, it names the current citation and "Cite this" replaces it on the gateway', async () => {
    const check = [...gateway.checks.values()].find((c) => c.draftId === 'd1')!
    const citation = check.citations.find((c) => c.key === 'khattab2020')!
    const { onReplaced } = renderScreen({
      initialQuery: '',
      replacement: { draftId: 'd1', checkId: check.id, citationId: citation.id, claim: citation.claim },
    })
    expect(await screen.findByText(/Your current citation for this sentence is Khattab & Zaharia, 2020, which contradicts it/)).toBeInTheDocument()
    await screen.findByText(/ColBERTv2: Effective and Efficient Retrieval/)
    await waitFor(() => expect(screen.getAllByText('source backs it').length).toBeGreaterThan(0), { timeout: 4000 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Cite this' })[0])
    await waitFor(() => expect(onReplaced).toHaveBeenCalledWith('d1'))
    expect(gateway.calls).toContain('PUT /author/drafts/d1/files/related-work.tex')
    expect(gateway.drafts.get('d1')!.files.find((f) => f.name === 'related-work.tex')!.content).toContain('\\cite{santhanam2022b}')
    const updated = gateway.checks.get(check.id)!.citations.find((c) => c.id === citation.id)!
    expect(updated).toMatchObject({ key: 'santhanam2022b', verdict: 'supports', resolution: { kind: 'replaced', previousKey: 'khattab2020' } })
  })

  test('without a citation to replace, "Cite this" copies the \\cite and reports a refused clipboard honestly', async () => {
    renderScreen()
    await screen.findByText(/PLAID/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Cite this' })[0])
    expect(await screen.findByRole('status')).toHaveTextContent('Copied \\cite{santhanam2022b}')

    ;(navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getAllByRole('button', { name: 'BibTeX' })[0])
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy — the browser refused clipboard access'))
  })

  test('"Add to library" saves the result on the gateway', async () => {
    renderScreen()
    await screen.findByText(/PLAID/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to library' })[0])
    await waitFor(() => expect(gateway.calls).toContain('POST /author/sources'))
    expect([...gateway.sources.values()][0].title).toMatch(/ColBERTv2/)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add to library' })).toHaveLength(1))
  })

  test('opened from a draft in no project, "Add to library" saves to Unsorted sources', async () => {
    gateway.drafts.get('d1')!.projectId = null
    renderScreen({ draftId: 'd1' })
    await screen.findByText(/PLAID/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to library' })[0])
    await waitFor(() => expect(gateway.calls).toContain('POST /author/sources'))
    expect([...gateway.sources.values()][0].projectId).toBeNull()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Saved .* to Unsorted sources/))
  })

  test('an index outage is shown with a retry', async () => {
    gateway.fetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/author/search?')) return Promise.resolve(new Response(JSON.stringify({ detail: 'Semantic Scholar is rate limiting us' }), { status: 503 }))
      return Promise.resolve(new Response('[]', { status: 200 }))
    })
    renderScreen()
    expect(await screen.findByText(/Could not search: Semantic Scholar is rate limiting us/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
