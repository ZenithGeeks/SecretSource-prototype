/** Researcher Home: greeting, a single primary Analyze button, and the library legend's count words. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

const HOME = {
  alert: '3 new papers disagree with something in your library.',
  conflicts: [
    { claim: 'Residual compression loses no quality', for: ['ColBERTv2'], against: [], analysis: 'a1', claimIndex: 0 },
    { claim: 'Late interaction wins', for: ['PLAID'], against: ['BEIR'], analysis: 'a1', claimIndex: 1 },
  ],
  queue: [{ paper: 'PLAID (2022)', note: 'Cited by 3', identifier: '10.1/plaid', analysis: 'a1' }],
  library: { papers: 9, claims: 53, verified: 40, tally: { backed: 28, silent: 7, contradicted: 1, unchecked: 17 } },
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function renderHome() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(String(url).includes('/researcher/home') ? JSON.stringify(HOME) : '[]', { status: 200 }),
    ),
  )
  window.history.replaceState(null, '', '?role=researcher&screen=home')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ResearcherApp />
    </QueryClientProvider>,
  )
}

test('greets the reader with the summary line', async () => {
  renderHome()
  expect(await screen.findByRole('heading', { level: 1, name: /^Good morning/ })).toBeInTheDocument()
  expect(screen.getByText(HOME.alert)).toBeInTheDocument()
})

test('Analyze is the only primary button in the analyze card', async () => {
  renderHome()
  const card = within(await screen.findByRole('region', { name: 'Analyze a paper' }))
  const primary = card.getAllByRole('button').filter((b) => b.className.includes('bg-accent '))
  expect(primary.map((b) => b.textContent)).toEqual(['Analyze'])
})

test('the library legend uses the count words and conflicts say what is missing', async () => {
  renderHome()
  const library = within(await screen.findByRole('region', { name: 'Your library' }))
  expect(library.getByText('back it')).toBeInTheDocument()
  expect(library.getByText('silent')).toBeInTheDocument()
  expect(library.getByText('contradicts')).toBeInTheDocument() // 1, singular
  expect(library.getByText('not checked')).toBeInTheDocument()
  expect(screen.getByText('No counter-evidence yet')).toBeInTheDocument()
})

test('Analyze on a queued paper puts its identifier in the analyze box', async () => {
  renderHome()
  fireEvent.click(await screen.findByRole('button', { name: /^Put PLAID/ }))
  expect(screen.getByLabelText('Paper to analyze')).toHaveValue('10.1/plaid')
})
