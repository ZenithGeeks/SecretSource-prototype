/** The labeler's Scopus search (#578): order, year range, a count with Show 25 more, rows that
 * open to the abstract, and empty and failed searches that say what to do. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Pool, ScopusPaper } from '../src/lib/labeling'
import { ScopusAdd } from '../src/roles/labeler/components/ScopusAdd'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const POOL: Pool = { topics: ['CV', 'NLP'], me: 'Chanya', people: [], papers: [] }

const paper = (n: number, extra: Partial<ScopusPaper> = {}): ScopusPaper => ({
  doi: `10.1/${n}`,
  title: `Paper ${n}`,
  venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
  year: '2021',
  first_author: 'Gallego G.',
  cited_by: 2442 - n,
  abstract: n === 0 ? 'Event cameras are bio-inspired sensors.' : '',
  subject: n === 0 ? 'Advanced Vision and Imaging' : '',
  keywords: n === 0 ? ['event cameras', 'neuromorphic vision'] : [],
  downloadable: true,
  added: false,
  ...extra,
})

/** Answers the search with `pages` in turn and records each URL asked for. */
function gateway(pages: (object | Response)[]) {
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(new URL(url, 'http://x').searchParams)
      const next = pages.shift() ?? { total: 0, results: [] }
      return next instanceof Response ? next : Response.json(next)
    }),
  )
  return asked
}

function renderSearch() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScopusAdd pool={POOL} myTopic="CV" />
    </QueryClientProvider>,
  )
}

const search = () => fireEvent.click(screen.getByRole('button', { name: 'Search Scopus' }))

describe('the Scopus search', () => {
  it('asks for most cited within the years, and shows how many there are', async () => {
    const asked = gateway([{ total: 105, results: Array.from({ length: 25 }, (_, n) => paper(n)) }])
    renderSearch()

    fireEvent.change(screen.getByLabelText('To year'), { target: { value: '2022' } })
    search()

    expect(await screen.findByText('105 papers · showing 25')).toBeInTheDocument()
    expect(Object.fromEntries(asked[0])).toMatchObject({ topic: 'CV', q: '', since: '2020', until: '2022', sort: 'cited', page: '0' })
  })

  it('shows the next 25 on request, from the next page', async () => {
    const asked = gateway([
      { total: 30, results: Array.from({ length: 25 }, (_, n) => paper(n)) },
      { total: 30, results: Array.from({ length: 5 }, (_, n) => paper(25 + n)) },
    ])
    renderSearch()
    search()

    fireEvent.click(await screen.findByRole('button', { name: 'Show 25 more' }))

    expect(await screen.findByText('30 papers · showing 30')).toBeInTheDocument()
    expect(asked[1].get('page')).toBe('1')
    expect(screen.queryByRole('button', { name: 'Show 25 more' })).not.toBeInTheDocument()
  })

  it('opens a paper to its abstract and a link to its page', async () => {
    gateway([{ total: 2, results: [paper(0), paper(1)] }])
    renderSearch()
    search()

    const list = await screen.findByRole('list', { name: 'Scopus results' })
    fireEvent.click(within(list).getByRole('button', { name: /^Paper 0/ }))

    expect(screen.getByText('Event cameras are bio-inspired sensors.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the paper's page/ })).toHaveAttribute('href', 'https://doi.org/10.1/0')

    fireEvent.click(within(list).getByRole('button', { name: /^Paper 1/ }))
    expect(screen.getByText('OpenAlex has no abstract for this paper.')).toBeInTheDocument()
  })

  it('shows each result’s subject and keywords, and nothing for a paper OpenAlex has none for', async () => {
    gateway([{ total: 2, results: [paper(0), paper(1)] }])
    renderSearch()
    search()

    const list = await screen.findByRole('list', { name: 'Scopus results' })
    const tags = within(list).getAllByRole('list', { name: 'Subject and keywords' })
    expect(tags).toHaveLength(1)
    expect(within(tags[0]).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Advanced Vision and Imaging',
      'event cameras',
      'neuromorphic vision',
    ])
  })

  it('asks for best match only with words, and keeps the years in order', async () => {
    const asked = gateway([{ total: 0, results: [] }, { total: 0, results: [] }])
    renderSearch()

    fireEvent.click(screen.getByRole('radio', { name: 'Best match' }))
    fireEvent.change(screen.getByLabelText('From year'), { target: { value: '2024' } })
    fireEvent.change(screen.getByLabelText('To year'), { target: { value: '2021' } })
    search()
    await waitFor(() => expect(asked).toHaveLength(1))

    // No words, so most cited; a range that ends before it starts ends where it starts.
    expect(Object.fromEntries(asked[0])).toMatchObject({ sort: 'cited', since: '2024', until: '2024' })
    expect(screen.getByLabelText('To year')).toHaveValue(2024)
  })

  it('offers a wider search when nothing matches', async () => {
    const asked = gateway([{ total: 0, results: [] }, { total: 1, results: [paper(0)] }])
    renderSearch()
    fireEvent.change(screen.getByLabelText(/Words in the title/), { target: { value: 'quantum knitting' } })
    search()

    fireEvent.click(await screen.findByRole('button', { name: 'Search without the words' }))

    expect(await screen.findByText('1 papers · showing 1')).toBeInTheDocument()
    expect(asked[1].get('q')).toBe('')
  })

  it('searches the topic venues unless asked for all of Scopus, and offers that when nothing matches', async () => {
    const asked = gateway([{ total: 0, results: [] }, { total: 1, results: [paper(0)] }])
    renderSearch()
    fireEvent.change(screen.getByLabelText(/Words in the title/), { target: { value: 'Ozaki scheme' } })
    search()

    fireEvent.click(await screen.findByRole('button', { name: 'Search all of Scopus' }))

    expect(await screen.findByText('1 papers · showing 1')).toBeInTheDocument()
    expect(asked.map((params) => params.get('scope'))).toEqual(['topic', 'all'])
    expect(screen.getByRole('radio', { name: 'All of Scopus' })).toHaveAttribute('aria-checked', 'true')
  })

  it('says when a pasted DOI is not in Scopus, without suggestions that do not apply to it', async () => {
    const asked = gateway([{ total: 0, results: [] }])
    renderSearch()
    const link = 'https://dl.acm.org/doi/10.1145/3784828.3785017'
    fireEvent.change(screen.getByLabelText(/Words in the title/), { target: { value: link } })
    search()

    expect(await screen.findByText('Scopus has no paper with that DOI.')).toBeInTheDocument()
    expect(asked[0].get('q')).toBe(link)
    expect(screen.queryByRole('button', { name: 'Search all of Scopus' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search without the words' })).toBeNull()
  })

  it('says why a search failed, and tries again', async () => {
    gateway([new Response('{"detail":"the Scopus key has used its quota for now"}', { status: 429 }), { total: 1, results: [paper(0)] }])
    renderSearch()
    search()

    expect(await screen.findByRole('alert')).toHaveTextContent('The Scopus key has used its quota for now.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('1 papers · showing 1')).toBeInTheDocument()
  })

  it('offers no Add for a paper whose only copy cannot be downloaded', async () => {
    gateway([{ total: 3, results: [paper(0, { downloadable: false }), paper(1, { downloadable: null }), paper(2)] }])
    renderSearch()
    search()

    expect(await screen.findByText('No copy we can download')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Paper 0' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Paper 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add Paper 2' })).toBeEnabled()
  })
})
