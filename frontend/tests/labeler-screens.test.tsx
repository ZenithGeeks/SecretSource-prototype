/** The Queue and Blind checks screens in the states their main tests leave out. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  pool: null as Record<string, unknown> | null,
  poolHangs: false,
  status: { annotator: 'Chanya', configured: true, scopus: true } as Record<string, unknown> | Error,
  statusCalls: 0,
  put: 'ok' as 'ok' | 'fail' | 'hang',
  puts: [] as unknown[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/labeling/status') {
      gateway.statusCalls += 1
      if (gateway.status instanceof Error) throw gateway.status
      return gateway.status
    }
    if (path === '/labeling/pool') {
      if (gateway.poolHangs) await new Promise(() => undefined)
      if (!gateway.pool) throw new Error('500: down')
      return gateway.pool
    }
    if (init?.method === 'PUT') {
      gateway.puts.push(JSON.parse(String(init.body)))
      if (gateway.put === 'hang') await new Promise(() => undefined)
      if (gateway.put === 'fail') throw new Error('503: not set up')
      return {}
    }
    throw new Error(`unexpected ${path}`)
  }),
}))

import type { Pool } from '../src/lib/labeling'
import { BlindChecks } from '../src/roles/labeler/screens/BlindChecks'
import { Queue } from '../src/roles/labeler/screens/Queue'

type Paper = Pool['papers'][number]

const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  analysis_id: id,
  title: `Paper ${id}`,
  topic: 'CV',
  claims: 4,
  judged: 0,
  team_judged: 4,
  labelers: ['Somchai'],
  status: 'done',
  reason: '',
  mine: false,
  added_by: 'Somchai',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
  ...over,
})

const pool = (over: Partial<Pool> = {}): Pool => ({
  topics: ['CV', 'NLP'],
  me: 'Chanya',
  people: [
    { name: 'Chanya', topic: 'NLP' },
    { name: 'Somchai', topic: 'CV' },
    { name: 'Ann', topic: '' },
  ],
  papers: [],
  ...over,
})

const withQuery = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

beforeEach(() => {
  gateway.pool = null
  gateway.poolHangs = false
  gateway.status = { annotator: 'Chanya', configured: true, scopus: true }
  gateway.statusCalls = 0
  gateway.put = 'ok'
  gateway.puts.length = 0
  window.history.replaceState(null, '', '/')
})
afterEach(() => vi.restoreAllMocks())

describe('Queue', () => {
  const renderQueue = () => withQuery(<Queue onOpen={vi.fn()} onShowBlind={vi.fn()} />)

  it('tries the status again from the error screen', async () => {
    gateway.status = new Error('500: down')
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(gateway.statusCalls).toBe(2))
  })

  it('says the papers are loading, not that there are none, until the list arrives', async () => {
    gateway.poolHangs = true
    renderQueue()
    expect(await screen.findByText('Loading papers…')).toHaveAttribute('role', 'status')
    expect(screen.queryByText('No papers yet')).not.toBeInTheDocument()
  })

  it('still shows the page when the paper list cannot be read', async () => {
    renderQueue()
    expect(await screen.findByText('No papers yet')).toBeInTheDocument()
    expect(screen.getByText('Use Add papers to search Scopus. A paper appears here once its text has been read.')).toBeInTheDocument()
    expect(screen.queryByText('Who labels what')).not.toBeInTheDocument()
  })

  it('counts several blind papers and several papers being read', async () => {
    gateway.pool = pool({
      blind: ['b1', 'b2'],
      papers: [paper('b1'), paper('b2'), paper('r1', { status: 'running' }), paper('r2', { status: 'running' }), paper('d1')],
    })
    renderQueue()
    expect(await screen.findByText('You have 2 papers to check blind.')).toBeInTheDocument()
    expect(screen.getByText('Reading 2 papers. This list updates by itself.')).toBeInTheDocument()
  })

  it('counts one blind paper and one paper being read', async () => {
    gateway.pool = pool({ blind: ['b1'], papers: [paper('b1'), paper('r1', { status: 'running' })] })
    renderQueue()
    expect(await screen.findByText('You have 1 paper to check blind.')).toBeInTheDocument()
    expect(screen.getByText('Reading 1 paper. This list updates by itself.')).toBeInTheDocument()
  })

  it('lists blind checks, hiding who labeled one until it is finished, and opens their labels only then', async () => {
    gateway.pool = pool({ lead: true, blind: ['b1', 'b2'], papers: [paper('b1'), paper('b2', { judged: 4 })] })
    const onOpen = vi.fn()
    const onOpenLabels = vi.fn()
    withQuery(<Queue onOpen={onOpen} onOpenLabels={onOpenLabels} onShowBlind={vi.fn()} />)
    const unfinished = (await screen.findByRole('link', { name: 'Paper b1 (Start)' })).closest('tr')!
    expect(within(unfinished).getByText('Blind check')).toBeInTheDocument()
    expect(within(unfinished).getByText('Hidden until you finish')).toBeInTheDocument()
    fireEvent.click(within(unfinished).getByRole('link', { name: 'Paper b1 (Start)' }))
    expect(onOpen).toHaveBeenCalledWith('b1') // a lead's own blind check still opens to label
    // A link, so a modified click opens the paper in a new tab and leaves this page as it is.
    const link = within(unfinished).getByRole('link', { name: 'Paper b1 (Start)' })
    expect(link).toHaveAttribute('href', '?analysis=b1')
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(fireEvent.click(link, modifier)).toBe(true) // not prevented: the browser opens it
    }
    expect(onOpen).toHaveBeenCalledOnce()

    const finished = screen.getByRole('link', { name: 'Paper b2 (View labels)' }).closest('tr')!
    expect(within(finished).queryByText('Hidden until you finish')).not.toBeInTheDocument()
    expect(within(finished).getByText('Somchai')).toBeInTheDocument()
    expect(within(finished).getByRole('link', { name: 'Paper b2 (View labels)' })).toHaveAttribute('href', '?labels=b2')
    fireEvent.click(within(finished).getByRole('link', { name: 'Paper b2 (View labels)' }))
    expect(onOpenLabels).toHaveBeenCalledWith('b2')
  })

  it('warns when the database is not set up and when Scopus is missing', async () => {
    gateway.status = { annotator: 'Chanya', configured: false, scopus: false }
    gateway.pool = pool({ papers: [paper('d1')] })
    renderQueue()
    expect(await screen.findByText('Scopus search is not set up yet')).toBeInTheDocument()
    expect(screen.getAllByText('Labels cannot be saved yet').length).toBeGreaterThan(0)
  })

  it('puts unfinished papers first, then the reader’s own topic, then by topic', async () => {
    gateway.pool = pool({
      papers: [
        paper('cv-done', { topic: 'CV', judged: 4, title: 'CV done' }),
        paper('cv-open', { topic: 'CV', title: 'CV open' }),
        paper('nlp', { topic: 'NLP', title: 'NLP one' }),
        paper('nlp-done', { topic: 'NLP', judged: 4, title: 'NLP done' }),
      ],
    })
    renderQueue()
    await screen.findByRole('button', { name: 'Continue: NLP one' })
    const titles = screen.getAllByRole('row').slice(1).map((row) => row.querySelector('.line-clamp-2')?.textContent)
    expect(titles).toEqual(['NLP one', 'CV open', 'NLP done', 'CV done'])
  })

  it('keeps room for the menu on rows of papers the viewer did not add, so the rows line up', async () => {
    gateway.pool = pool({ papers: [paper('p-theirs', { mine: false }), paper('p-mine', { mine: true })] })
    renderQueue()
    await screen.findByRole('link', { name: 'Paper p-theirs (Start)' })
    const theirs = screen.getByRole('link', { name: 'Paper p-theirs (Start)' }).closest('tr')!
    const mine = screen.getByRole('link', { name: 'Paper p-mine (Start)' }).closest('tr')!
    expect(theirs.querySelector('span[aria-hidden="true"].size-10')).not.toBeNull()
    expect(within(theirs).queryByRole('button', { name: /^More actions/ })).not.toBeInTheDocument()
    expect(mine.querySelector('span[aria-hidden="true"].size-10')).toBeNull()
    expect(within(mine).getByRole('button', { name: /^More actions/ })).toBeInTheDocument()
  })

  it('offers Continue for the next unfinished paper and puts Add papers and Downloads behind disclosures', async () => {
    const onOpen = vi.fn()
    gateway.pool = pool({
      papers: [paper('p-done', { judged: 4, title: 'Finished' }), paper('p-next', { title: 'Next unfinished' })],
    })
    withQuery(<Queue onOpen={onOpen} onShowBlind={vi.fn()} />)
    const cont = await screen.findByRole('button', { name: 'Continue: Next unfinished' })
    expect(cont).toHaveAttribute('title', 'Next unfinished')
    expect(screen.getByRole('heading', { name: 'All papers' })).toBeInTheDocument()
    fireEvent.click(cont)
    expect(onOpen).toHaveBeenCalledWith('p-next')

    expect(screen.queryByRole('button', { name: 'Download labels CSV' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Downloads' }))
    expect(screen.getByRole('button', { name: 'Download labels CSV' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Search Scopus' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add papers' }))
    expect(screen.getByRole('button', { name: 'Search Scopus' })).toBeInTheDocument()
  })
})

describe('Blind checks', () => {
  const renderBlind = () => withQuery(<BlindChecks onOpen={vi.fn()} />)

  it('says so when the paper list cannot be read', async () => {
    renderBlind()
    expect(await screen.findByText('The paper list could not be read')).toBeInTheDocument()
  })

  it('treats an older gateway, with no blind list, as having no checks', async () => {
    gateway.pool = pool({ papers: [paper('a')] })
    renderBlind()
    expect(await screen.findByText('No blind checks for you')).toBeInTheDocument()
  })

  it('shows each check as Start, Continue or Review, and holds back one still being read', async () => {
    gateway.pool = pool({
      blind: ['s', 'c', 'f', 'r'],
      papers: [
        paper('s', { title: 'Fresh' }),
        paper('c', { title: 'Midway', judged: 1 }),
        paper('f', { title: 'Finished', judged: 4 }),
        paper('r', { title: 'Reading', status: 'running' }),
      ],
    })
    renderBlind()
    const list = await screen.findByRole('list')
    const rowOf = (title: string) => within(list).getByText(title).closest('li') as HTMLElement
    expect(within(rowOf('Fresh')).getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(within(rowOf('Midway')).getByRole('button', { name: 'Continue' })).toBeEnabled()
    expect(within(rowOf('Finished')).getByRole('button', { name: 'Review' })).toBeEnabled()
    expect(within(rowOf('Finished')).getByText('Done')).toBeInTheDocument()
    expect(within(rowOf('Reading')).getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  describe('as a lead', () => {
    const leadPool = (over: Partial<Pool> = {}) =>
      pool({
        lead: true,
        blind: [],
        papers: [paper('x1', { title: 'Labeled paper', topic: 'CV', labelers: ['Somchai'] }), paper('x2', { title: 'Unlabeled', team_judged: 0 })],
        ...over,
      })

    it('offers only papers somebody has labeled, and names people without a topic plainly', async () => {
      gateway.pool = leadPool()
      renderBlind()
      expect(await screen.findByRole('option', { name: 'Ann' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Somchai (CV)' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Labeled paper' }).parentElement).toHaveAttribute('label', 'CV')
      expect(screen.queryByRole('option', { name: /Unlabeled/ })).not.toBeInTheDocument()
    })

    it('ignores a submit before a person and a paper are chosen', async () => {
      gateway.pool = leadPool()
      renderBlind()
      const person = await screen.findByLabelText('Person')
      fireEvent.submit(person.closest('form') as HTMLFormElement)
      expect(gateway.puts).toEqual([])
    })

    it('says when the person already has the paper as a blind check, and when the topic is the same', async () => {
      gateway.pool = leadPool({ blind_checks: [{ name: 'Ann', analysis_id: 'x1' }] })
      renderBlind()
      const person = await screen.findByLabelText('Person')
      fireEvent.change(screen.getByLabelText('Paper'), { target: { value: 'x1' } })
      fireEvent.change(person, { target: { value: 'Ann' } })
      expect(screen.getByText('Ann already has this paper as a blind check.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()

      fireEvent.change(person, { target: { value: 'Chanya' } })
      expect(screen.queryByText(/already has this paper/)).not.toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('Paper'), { target: { value: 'x1' } })
      fireEvent.change(person, { target: { value: 'Somchai' } })
      expect(screen.getByText(/Somchai already labeled/)).toBeInTheDocument()
    })

    it('warns about the same topic but still allows it', async () => {
      gateway.pool = leadPool({ people: [{ name: 'Chanya', topic: 'CV' }, { name: 'Ann', topic: 'NLP' }] })
      renderBlind()
      fireEvent.change(await screen.findByLabelText('Person'), { target: { value: 'Chanya' } })
      fireEvent.change(screen.getByLabelText('Paper'), { target: { value: 'x1' } })
      expect(screen.getByText('Same topic as this person: allowed, but a paper from another topic tells more.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Assign' })).toBeEnabled()
    })

    it('keeps the form off while an assignment saves', async () => {
      gateway.pool = leadPool()
      gateway.put = 'hang'
      renderBlind()
      fireEvent.change(await screen.findByLabelText('Person'), { target: { value: 'Ann' } })
      fireEvent.change(screen.getByLabelText('Paper'), { target: { value: 'x1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled())
    })

    it('says why an assignment failed', async () => {
      gateway.pool = leadPool()
      gateway.put = 'fail'
      renderBlind()
      fireEvent.change(await screen.findByLabelText('Person'), { target: { value: 'Ann' } })
      fireEvent.change(screen.getByLabelText('Paper'), { target: { value: 'x1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Labels cannot be saved yet.')
    })

    it('lists the checks so far by paper title, or by id for a paper no longer listed, and takes one back', async () => {
      gateway.pool = leadPool({
        blind_checks: [
          { name: 'Ann', analysis_id: 'x1' },
          { name: 'Somchai', analysis_id: 'gone' },
        ],
      })
      renderBlind()
      const table = await screen.findByRole('table', { name: 'Assigned (2)' })
      expect(within(table).getByText('Labeled paper')).toBeInTheDocument()
      expect(within(table).getByText('gone')).toBeInTheDocument()

      fireEvent.click(within(table).getByRole('button', { name: "Take back Ann's blind check of this paper" }))
      await waitFor(() => expect(gateway.puts).toEqual([{ name: 'Ann', analysis_id: 'x1', on: false }]))
    })

    it('treats a missing list of checks as none', async () => {
      gateway.pool = leadPool()
      renderBlind()
      await screen.findByLabelText('Person')
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })
})
