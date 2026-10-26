/** Venue rank chips and the rank filter (SCRUM-445). CiteScore for journals, CORE for
 * conferences, "Conference, unranked" when there is no rank, and "Rank unavailable" when the
 * lookup failed. The filter sends repeatable `rank` params; all of Scopus says how many of the
 * page that hid. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { poolVenueRankLabel, scopusResultLine, venueRankLabel, type Pool, type ScopusPaper } from '../src/lib/labeling'
import { PaperTable } from '../src/roles/labeler/components/PaperTable'
import { ScopusAdd } from '../src/roles/labeler/components/ScopusAdd'
import type { Paper } from '../src/roles/labeler/paperFilters'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const POOL: Pool = { topics: ['CV', 'NLP'], me: 'Chanya', people: [], papers: [] }

const paper = (n: number, extra: Partial<ScopusPaper> = {}): ScopusPaper => ({
  doi: `10.1/${n}`,
  title: `Paper ${n}`,
  venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
  year: '2024',
  first_author: 'Gallego G.',
  cited_by: 10,
  abstract: '',
  subject: '',
  keywords: [],
  downloadable: true,
  added: false,
  ...extra,
})

function gateway(pages: object[]) {
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(new URL(url, 'http://x').searchParams)
      return Response.json(pages.shift() ?? { total: 0, results: [], hidden: 0 })
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

describe('venue rank chip text', () => {
  it('names CiteScore with its year, CORE without one, an unranked conference, and a failed lookup', () => {
    expect(venueRankLabel({ system: 'CiteScore', value: 'Q1', year: 2025 })).toBe('Q1 · CiteScore 2025')
    expect(venueRankLabel({ system: 'CiteScore', value: 'Q2', year: 2024 })).toBe('Q2 · CiteScore 2024')
    expect(venueRankLabel({ system: 'CORE', value: 'A*', year: 2026 })).toBe('A* · CORE')
    expect(venueRankLabel({ system: 'CORE', value: 'A', year: 2026 })).toBe('A · CORE')
    expect(venueRankLabel({ system: null, value: 'unranked', year: null })).toBe('Conference, unranked')
    expect(venueRankLabel(null)).toBe('Rank unavailable')
    expect(venueRankLabel(undefined)).toBeNull()
  })

  it('uses the same words for a pool paper, and nothing when the rank was not stored', () => {
    expect(poolVenueRankLabel('Q1', 'CiteScore 2025')).toBe('Q1 · CiteScore 2025')
    expect(poolVenueRankLabel('A*', 'CORE 2026')).toBe('A* · CORE')
    expect(poolVenueRankLabel('unranked', '')).toBe('Conference, unranked')
    expect(poolVenueRankLabel('', '')).toBeNull()
    expect(poolVenueRankLabel(undefined, undefined)).toBeNull()
  })

  it('does not call a failed lookup unranked', () => {
    expect(venueRankLabel(null)).not.toMatch(/unranked/i)
  })
})

describe('the rank filter', () => {
  it('shows the four chips on search results', async () => {
    gateway([
      {
        total: 4,
        hidden: 0,
        results: [
          paper(0, { title: 'Journal paper', rank: { system: 'CiteScore', value: 'Q1', year: 2025 } }),
          paper(1, { title: 'Conference paper', rank: { system: 'CORE', value: 'A*', year: 2026 } }),
          paper(2, { title: 'Workshop paper', rank: { system: null, value: 'unranked', year: null } }),
          paper(3, { title: 'Unknown venue', rank: null }),
          paper(4, { title: 'Older gateway' }),
        ],
      },
    ])
    renderSearch()
    search()

    const list = await screen.findByRole('list', { name: 'Scopus results' })
    expect(within(list).getByText('Q1 · CiteScore 2025')).toBeInTheDocument()
    expect(within(list).getByText('A* · CORE')).toBeInTheDocument()
    expect(within(list).getByText('Conference, unranked')).toBeInTheDocument()
    expect(within(list).getByText('Rank unavailable')).toBeInTheDocument()
    const older = within(list).getByRole('button', { name: /^Older gateway/ })
    expect(within(older).queryByText('Rank unavailable')).toBeNull()
    expect(within(older).queryByText(/unranked/i)).toBeNull()
  })

  it('sends one rank for Q1 and does not mention a hidden page on topic venues', async () => {
    const asked = gateway([{ total: 2, hidden: 0, results: [paper(0), paper(1)] }])
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'Q1' }))
    search()

    expect(await screen.findByText('2 papers · showing 2')).toBeInTheDocument()
    expect(screen.queryByText(/on this page/)).toBeNull()
    expect(asked[0].getAll('rank')).toEqual(['Q1'])
  })

  it('sends Q1 and Q2, and on all of Scopus says how many of the page are showing', async () => {
    const asked = gateway([{ total: 80, hidden: 2, results: Array.from({ length: 23 }, (_, n) => paper(n)) }])
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'All of Scopus' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Q1-Q2' }))
    search()

    expect(await screen.findByText('80 papers · showing 23 of 25 on this page')).toBeInTheDocument()
    expect(asked[0].get('scope')).toBe('all')
    expect(asked[0].getAll('rank')).toEqual(['Q1', 'Q2'])
  })

  it('sends A* and A, and Any sends no rank', async () => {
    const asked = gateway([
      { total: 1, hidden: 0, results: [paper(0)] },
      { total: 1, hidden: 0, results: [paper(0)] },
    ])
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'A*/A' }))
    search()
    await screen.findByText('1 papers · showing 1')

    fireEvent.click(screen.getByRole('radio', { name: 'Any' }))
    search()
    await screen.findByText('1 papers · showing 1')

    expect(asked[0].getAll('rank')).toEqual(['A*', 'A'])
    expect(asked[1].getAll('rank')).toEqual([])
  })

  it('keeps asking for the next page when a rank filter hid the whole page', async () => {
    gateway([
      { total: 40, hidden: 25, results: [] },
      { total: 40, hidden: 0, results: [paper(0, { title: 'Kept paper', rank: { system: 'CiteScore', value: 'Q1', year: 2025 } })] },
    ])
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'All of Scopus' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Q1' }))
    search()

    expect(await screen.findByText('40 papers · showing 0 of 25 on this page')).toBeInTheDocument()
    expect(screen.getByText('No paper on this page has that rank.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 25 more' }))
    expect(await screen.findByText('Kept paper')).toBeInTheDocument()
    expect(screen.getByText('40 papers · showing 1 of 26 on these pages')).toBeInTheDocument()
  })
})

describe('the count line', () => {
  it('adds the per-page note only for a rank filter on all of Scopus', () => {
    const page = { results: Array.from({ length: 23 }), hidden: 2 }
    expect(scopusResultLine(80, [page], 'all', ['Q1'])).toBe('80 papers · showing 23 of 25 on this page')
    expect(scopusResultLine(80, [page], 'topic', ['Q1'])).toBe('80 papers · showing 23')
    expect(scopusResultLine(80, [page], 'all', [])).toBe('80 papers · showing 23')
  })
})

const poolPaper = (extra: Partial<Paper>): Paper => ({
  analysis_id: extra.analysis_id ?? 'p',
  title: extra.title ?? 'Paper',
  topic: 'CV',
  claims: 2,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status: 'done',
  reason: '',
  mine: false,
  added_by: 'Chanya',
  subject: '',
  keywords: [],
  ...extra,
})

describe('pool paper chips', () => {
  it('shows CiteScore, CORE and unranked, and nothing when the rank is missing', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PaperTable
          me="Chanya"
          myTopic="CV"
          onOpen={() => {}}
          papers={[
            poolPaper({ analysis_id: 'j', title: 'Journal', venue_rank: 'Q1', venue_rank_source: 'CiteScore 2025' }),
            poolPaper({ analysis_id: 'c', title: 'Conference', venue_rank: 'A*', venue_rank_source: 'CORE 2026' }),
            poolPaper({ analysis_id: 'u', title: 'Workshop', venue_rank: 'unranked', venue_rank_source: '' }),
            poolPaper({ analysis_id: 'o', title: 'Already listed', venue_rank: '', venue_rank_source: '' }),
          ]}
        />
      </QueryClientProvider>,
    )
    const table = screen.getByRole('table')
    const rowOf = (title: string) => within(table).getAllByRole('row').find((row) => within(row).queryByText(title))!
    expect(within(rowOf('Journal')).getByText('Q1 · CiteScore 2025')).toBeInTheDocument()
    expect(within(rowOf('Conference')).getByText('A* · CORE')).toBeInTheDocument()
    expect(within(rowOf('Workshop')).getByText('Conference, unranked')).toBeInTheDocument()
    expect(within(rowOf('Already listed')).queryByText(/CiteScore|CORE|unranked|unavailable/)).toBeNull()
  })
})
