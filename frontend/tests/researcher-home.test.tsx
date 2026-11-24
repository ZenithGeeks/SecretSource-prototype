/** Researcher Home: greeting, a single primary Analyze button, and the library legend's count words. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { tallyEntries } from '../src/lib/researcher'
import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

const HOME = {
  alert: '3 new papers disagree with something in your library.',
  conflicts: [
    { claim: 'Late interaction wins', paper: 'ColBERTv2', for: ['PLAID', 'A very long cited work title'], against: ['BEIR'], analysis: 'a1', claimIndex: 1 },
  ],
  conflictsTotal: 28,
  queue: [{ paper: 'PLAID (2022)', note: 'Cited by 3', identifier: '10.1/plaid', analysis: 'a1' }],
  library: { papers: 9, claims: 53, verified: 40, tally: { backed: 28, silent: 7, contradicted: 1, unchecked: 17 } },
}

type Counts = Partial<Record<'refutes' | 'insufficient' | 'unchecked' | 'supports' | 'named' | 'uncited', number>>

/** One claim of each standing asked for, as the analyses list would carry them. */
function claimsWith(counts: Counts) {
  const make = {
    refutes: () => ({ claim: 'c', citations: [], verdicts: [{ verdict: 'refutes' }] }),
    insufficient: () => ({ claim: 'c', citations: [], verdicts: [{ verdict: 'insufficient' }] }),
    supports: () => ({ claim: 'c', citations: [], verdicts: [{ verdict: 'supports' }] }),
    unchecked: () => ({ claim: 'c', citations: [{ doi: '10.1/u' }], unchecked: [{ source: '10.1/u' }] }),
    named: () => ({ claim: 'c', citations: [{ doi: '10.1/n' }], named: ['10.1/n'] }),
    uncited: () => ({ claim: 'c', citations: [] }),
  }
  return Object.entries(counts).flatMap(([kind, n]) => Array.from({ length: n }, make[kind as keyof typeof make]))
}

const run = (id: string, paper: string, counts: Counts, fields = {}) => ({
  id,
  paper,
  title: paper,
  status: 'done',
  claims: claimsWith(counts),
  stages: [],
  ...fields,
})

const LIBRARY = [run('a1', 'ColBERTv2', { refutes: 1, insufficient: 7, unchecked: 17, supports: 28 })]

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function renderHome(home: typeof HOME = HOME, analyses: object[] = LIBRARY) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(
        String(url).includes('/researcher/home') ? JSON.stringify(home) : String(url).endsWith('/analyses') ? JSON.stringify(analyses) : '[]',
        { status: 200 },
      ),
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
  // No date label above the title: the date leads the summary line.
  const meta = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.endsWith(` · ${HOME.alert}`) === true)
  expect(meta).toBeInTheDocument()
})

test('Analyze is the only primary button in the analyze card', async () => {
  renderHome()
  const card = within(await screen.findByRole('region', { name: 'Analyze a paper' }))
  const primary = card.getAllByRole('button').filter((b) => b.className.includes('bg-accent '))
  expect(primary.map((b) => b.textContent)).toEqual(['Analyze'])
})

test('the library legend uses the badge words, worst first', async () => {
  renderHome()
  const region = within(await screen.findByRole('region', { name: 'Your library' }))
  const library = within(region.getByRole('list'))
  const items = library.getAllByRole('listitem')
  // Worst first, in the badge words.
  expect(items.map((item) => item.textContent)).toEqual(['1Source contradicts', '7Source is silent', '17Not checked', '28Source backs it'])
})

test('the library card explains the verdict words in a key that opens on demand', async () => {
  renderHome()
  const region = within(await screen.findByRole('region', { name: 'Your library' }))
  const summary = region.getByText('What do these mean?')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveAttribute('open')
  expect(within(summary.closest('details') as HTMLElement).getByText('Source contradicts')).toBeInTheDocument()
  expect(region.getByText(/says something that goes against this claim/)).toBeInTheDocument()
})

test('/ puts focus in the analyze box, except while typing in a field', async () => {
  renderHome()
  const box = await screen.findByLabelText('Paper to analyze')
  expect(box).toHaveAttribute('aria-keyshortcuts', '/')
  fireEvent.keyDown(document.body, { key: '/' })
  expect(box).toHaveFocus()
  box.blur()
  fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })
  expect(box).not.toHaveFocus()
  fireEvent.keyDown(box, { key: '/' })
  expect((box as HTMLInputElement).value).toBe('')
})

test('the conflicts card counts every conflict and gives each cited work its own pill', async () => {
  renderHome()
  expect(await screen.findByRole('button', { name: 'All 28 in Library' })).toBeInTheDocument()
  expect(screen.getByTitle('BEIR')).toHaveAttribute('data-verdict', 'refutes')
  expect(screen.getByTitle('PLAID')).toHaveAttribute('data-verdict', 'supports')
  expect(screen.getByTitle('A very long cited work title')).toHaveAttribute('data-verdict', 'supports')
})

test('a dropped file that is not a PDF says why nothing happened', async () => {
  renderHome()
  const card = await screen.findByRole('region', { name: 'Analyze a paper' })
  const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
  fireEvent.drop(card, { dataTransfer: { files: [file] } })
  expect(screen.getByRole('alert')).toHaveTextContent('Only PDF files can be analyzed')

  fireEvent.change(screen.getByLabelText('Paper to analyze'), { target: { value: '10.1/x' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('Analyze on a queued paper puts its identifier in the analyze box', async () => {
  renderHome()
  fireEvent.click(await screen.findByRole('button', { name: /^Analyze PLAID/ }))
  expect(screen.getByLabelText('Paper to analyze')).toHaveValue('10.1/plaid')
})

test('a tally always lists the four checked standings in badge order, even at zero', () => {
  expect(tallyEntries({ backed: 0, silent: 0, contradicted: 0, unchecked: 0 }).map(({ kind, count }) => [kind, count])).toEqual([
    ['refutes', 0],
    ['insufficient', 0],
    ['unchecked', 0],
    ['supports', 0],
  ])
})

test('a tally adds "named" and "uncited" only when a claim has them', () => {
  const kinds = tallyEntries({ backed: 1, silent: 0, contradicted: 0, unchecked: 0, named: 2, uncited: 3 }).map(({ kind }) => kind)
  expect(kinds).toEqual(['refutes', 'insufficient', 'unchecked', 'supports', 'named', 'uncited'])
})

test('the library legend shows "No citation" with its count when a run has an uncited claim', async () => {
  renderHome(HOME, [run('a1', 'ColBERTv2', { supports: 2, uncited: 3 })])
  const region = within(await screen.findByRole('region', { name: 'Your library' }))
  const legend = within(region.getByRole('list'))
  expect(legend.getByText('No citation').closest('li')).toHaveTextContent('3No citation')
})

test('the library counts papers and claims from the newest finished run of each paper', async () => {
  renderHome(HOME, [
    run('new', 'ColBERTv2', { supports: 4 }, { completed: '2026-11-12T10:00:00' }),
    run('old', 'ColBERTv2', { supports: 9 }, { completed: '2026-11-01T10:00:00' }),
    run('other', 'PLAID', { refutes: 1 }, { completed: '2026-11-05T10:00:00' }),
    run('going', 'BEIR', { supports: 5 }, { status: 'running' }),
  ])
  const region = within(await screen.findByRole('region', { name: 'Your library' }))
  expect(region.getByText('2 papers · 5 claims')).toBeInTheDocument()
})

test('the library legend leaves out "Names a tool or dataset" when no claim names one', async () => {
  renderHome()
  const region = within(await screen.findByRole('region', { name: 'Your library' }))
  expect(within(region.getByRole('list')).queryByText('Names a tool or dataset')).not.toBeInTheDocument()
})

test('the library legend and the key both show "Names a tool or dataset" when a claim names one', async () => {
  renderHome(HOME, [run('a1', 'ColBERTv2', { supports: 2, named: 4 })])
  const region = within(await screen.findByRole('region', { name: 'Your library' }))
  const legend = within(region.getByRole('list'))
  expect(legend.getByText('Names a tool or dataset').closest('li')).toHaveTextContent('4Names a tool or dataset')
  fireEvent.click(region.getByText('What do these mean?'))
  expect(region.getAllByText('Names a tool or dataset')).toHaveLength(2)
})

test('each contradicted claim says "Contradicted by" before its red chips and "Also backed by" before the green ones', async () => {
  renderHome()
  const row = (await screen.findByRole('button', { name: /Late interaction wins/ })).closest('li') as HTMLElement
  expect(row).toHaveTextContent('Contradicted byBEIR· Also backed byPLAIDA very long cited work title')
})

test('a contradicted claim with no backing works leaves out "Also backed by"', async () => {
  const lone = { ...HOME.conflicts[0], for: [] as string[] }
  renderHome({ ...HOME, conflicts: [lone] })
  const row = (await screen.findByRole('button', { name: /Late interaction wins/ })).closest('li') as HTMLElement
  expect(row).toHaveTextContent('Contradicted byBEIR')
  expect(row).not.toHaveTextContent('Also backed by')
})
