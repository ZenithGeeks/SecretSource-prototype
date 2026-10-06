/** The researcher Library: one "Add papers" menu is the only primary button, and a paper
 * with no analysis says "Not analyzed". */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const PROJECT = {
  id: 'p1',
  name: 'Retrieval survey',
  papers: 2,
  claims: 9,
  clusters: 1,
  tally: { backed: 3, silent: 1, contradicted: 1, unchecked: 0 },
  updated: '',
}

const LIBRARY = {
  summary: '2 papers',
  clusters: ['All', 'Unverified', 'Late interaction'],
  papers: [
    {
      id: 'a1', title: 'ColBERTv2', cite: 'Santhanam et al. · 2022', cluster: 'Late interaction', claims: 9,
      backed: 6, contradicted: 1, linked: [], sourcesIndexed: 3, sourcesNotIndexed: 0, indexed: 'yes', index: '',
    },
    {
      id: 'a2', title: 'Tevatron toolkit', cite: 'Gao et al. · 2022', cluster: 'Tooling', claims: 4,
      backed: null, contradicted: null, linked: [], sourcesIndexed: 0, sourcesNotIndexed: 0, indexed: 'no', index: '',
    },
  ],
}

function renderLibrary() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = String(url).endsWith('/library') ? LIBRARY : String(url).includes('/researcher/projects') ? [PROJECT] : []
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
  window.history.replaceState(null, '', '?role=researcher&screen=library&project=p1')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ResearcherApp />
    </QueryClientProvider>,
  )
}

test('Add papers is one menu listing the existing add actions', async () => {
  renderLibrary()
  await screen.findByText('ColBERTv2')
  const add = screen.getByRole('button', { name: 'Add papers' })
  expect(add).toHaveAttribute('aria-haspopup', 'menu')
  // The old per-screen buttons are gone: the menu is the single primary action.
  expect(screen.queryByRole('button', { name: /^Add paper$/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /import bibliography/i })).not.toBeInTheDocument()

  // And it is the only solid (primary) button on the screen.
  const primaries = screen.getAllByRole('button').filter((b) => b.classList.contains('bg-accent'))
  expect(primaries).toEqual([add])

  fireEvent.click(add)
  const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
  expect(items.map((i) => i.querySelector('span')?.textContent)).toEqual([
    'From your analysed papers',
    'By DOI, arXiv ID or link',
    'Upload a PDF',
  ])
})

test('a paper with no analysis shows Not analyzed, and the index marker has no Scopus wording', async () => {
  renderLibrary()
  const row = (await screen.findByText('Tevatron toolkit')).closest('button')!
  expect(within(row).getByText('Not analyzed')).toBeInTheDocument()
  expect(within(row).getByText('Not found in a public index')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Not analyzed 1' })).toBeInTheDocument()
  expect(screen.getByText('1 contradicts')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/scopus/i)
})
