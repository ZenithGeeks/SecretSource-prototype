/** The Scopus search in the states scopus-search.test.tsx leaves out: pending adds and uploads,
 * long abstracts, the suggestions after an empty search, and the form's edge cases. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  online: true,
  searches: [] as URLSearchParams[],
  pages: [] as unknown[],
  hangPage: -1,
  add: 'ok' as 'ok' | 'fail' | 'hang',
  upload: 'ok' as 'ok' | 'fail' | 'hang',
  posts: [] as { path: string; body: unknown }[],
}))

vi.mock('../src/lib/api', async (original) => {
  const real = await original<typeof import('../src/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      uploadAnalysis: vi.fn(async () => {
        if (gateway.upload === 'hang') await new Promise(() => undefined)
        if (gateway.upload === 'fail') throw new Error('500: boom')
        return { id: 'up1' }
      }),
    },
    request: vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { features: { analyses: gateway.online } }
      if (path.startsWith('/labeling/scopus/search')) {
        const params = new URL(path, 'http://x').searchParams
        gateway.searches.push(params)
        if (gateway.hangPage === Number(params.get('page'))) await new Promise(() => undefined)
        return gateway.pages.shift() ?? { total: 0, results: [], hidden: 0 }
      }
      if (init?.method === 'POST') {
        gateway.posts.push({ path, body: JSON.parse(String(init.body)) })
        if (path === '/labeling/scopus/add') {
          if (gateway.add === 'hang') await new Promise(() => undefined)
          if (gateway.add === 'fail') throw new Error('502: Scopus is down')
        }
        return { id: 'n1', existing: false }
      }
      throw new Error(`unexpected ${path}`)
    }),
  }
})

import type { Pool, ScopusPaper } from '../src/lib/labeling'
import { ScopusAdd } from '../src/roles/labeler/components/ScopusAdd'

const POOL: Pool = { topics: ['CV', 'NLP'], me: 'Chanya', people: [], papers: [] }

const paper = (n: number, extra: Partial<ScopusPaper> = {}): ScopusPaper => ({
  doi: `10.1/${n}`,
  title: `Paper ${n}`,
  venue: 'TPAMI',
  year: '2021',
  first_author: 'Gallego G.',
  cited_by: 0,
  abstract: '',
  subject: '',
  keywords: [],
  downloadable: true,
  added: false,
  rank: null,
  ...extra,
})

function renderSearch(myTopic = 'CV') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScopusAdd pool={POOL} myTopic={myTopic} />
    </QueryClientProvider>,
  )
}
const search = () => fireEvent.click(screen.getByRole('button', { name: 'Search Scopus' }))
const results = () => screen.findByRole('list', { name: 'Scopus results' })

beforeEach(() => {
  gateway.online = true
  gateway.searches.length = 0
  gateway.pages.length = 0
  gateway.hangPage = -1
  gateway.add = 'ok'
  gateway.upload = 'ok'
  gateway.posts.length = 0
})

describe('the Scopus form', () => {
  it('will not search before a topic is picked, even when the form is submitted', () => {
    renderSearch('')
    expect(screen.getByRole('button', { name: 'Search Scopus' })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('From year').closest('form') as HTMLFormElement)
    expect(gateway.searches).toEqual([])
  })

  it('falls back to the default years for a blank or half-typed year, and keeps the range in order', async () => {
    renderSearch()
    fireEvent.change(screen.getByLabelText('From year'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('To year'), { target: { value: '1995' } })
    search()
    await waitFor(() => expect(gateway.searches).toHaveLength(1))
    expect(gateway.searches[0].get('since')).toBe('2020')
    expect(gateway.searches[0].get('until')).toBe('2020')
    expect(screen.getByLabelText('To year')).toHaveValue(2020)
  })

  it('searches all of Scopus after the scope is switched, under the chosen topic', async () => {
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'All of Scopus' }))
    expect(screen.getByText(/Open-access papers from any conference or journal/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Topic to search'), { target: { value: 'NLP' } })
    search()
    await waitFor(() => expect(gateway.searches[0].get('scope')).toBe('all'))
    expect(gateway.searches[0].get('topic')).toBe('NLP')
  })

  it('does not list venues for a topic it knows nothing about', () => {
    renderSearch('XX')
    expect(screen.getByText(/Open-access papers from the topic's conferences and journals\./)).toBeInTheDocument()
  })
})

describe('results', () => {
  it('shows a long abstract in four lines until the reader asks for the whole', async () => {
    gateway.pages.push({ total: 1, results: [paper(0, { abstract: 'word '.repeat(100) })] })
    renderSearch()
    search()
    fireEvent.click(await within(await results()).findByRole('button', { name: /^Paper 0/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Read the whole abstract' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByRole('button', { name: 'Read the whole abstract' })).toBeInTheDocument()
  })

  it('shows Added for a paper already listed, and for one just added', async () => {
    gateway.pages.push({ total: 2, results: [paper(0, { added: true }), paper(1)] })
    renderSearch()
    search()
    await results()
    expect(screen.getByRole('button', { name: 'Add Paper 0' })).toHaveTextContent('Added')
    fireEvent.click(screen.getByRole('button', { name: 'Add Paper 1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Paper 1' })).toHaveTextContent('Added'))
    expect(gateway.posts[0]).toEqual({ path: '/labeling/scopus/add', body: { doi: '10.1/1', topic: 'CV' } })
  })

  it('shows the paper being added while the gateway works, and says why an add failed', async () => {
    gateway.pages.push({ total: 2, results: [paper(0), paper(1)] })
    gateway.add = 'hang'
    renderSearch()
    search()
    await results()
    fireEvent.click(screen.getByRole('button', { name: 'Add Paper 0' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Paper 0' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Add Paper 1' })).toBeEnabled()
  })

  it('says why an add failed', async () => {
    gateway.pages.push({ total: 1, results: [paper(0)] })
    gateway.add = 'fail'
    renderSearch()
    search()
    await results()
    fireEvent.click(screen.getByRole('button', { name: 'Add Paper 0' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scopus did not answer.')
  })

  it('shows a paper being uploaded and keeps the other uploads off meanwhile', async () => {
    gateway.pages.push({ total: 2, results: [paper(0), paper(1)] })
    gateway.upload = 'hang'
    renderSearch()
    search()
    await results()
    const pdf = new File(['x'], 'p.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelectorAll('input[type="file"]')[0], { target: { files: [pdf] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uploading of Paper 0' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Upload the PDF of Paper 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Paper 0' })).toBeDisabled()
  })

  it('marks a paper added after its PDF was uploaded, and says why an upload failed', async () => {
    gateway.pages.push({ total: 2, results: [paper(0), paper(1)] })
    renderSearch()
    search()
    await results()
    const pdf = new File(['x'], 'p.pdf', { type: 'application/pdf' })
    const inputs = () => document.querySelectorAll('input[type="file"]')
    fireEvent.change(inputs()[0], { target: { files: [pdf] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Paper 0' })).toHaveTextContent('Added'))
    expect(gateway.posts.at(-1)?.body).toEqual({ topic: 'CV', doi: '10.1/0', replaces: '' })

    gateway.upload = 'fail'
    fireEvent.change(inputs()[0], { target: { files: [pdf] } })
    expect(await screen.findByText(/The PDF was not added: Something went wrong\./)).toBeInTheDocument()
  })

  it('shows a spinner on Show 25 more while the next page loads', async () => {
    gateway.pages.push({ total: 50, results: Array.from({ length: 25 }, (_, n) => paper(n)) })
    gateway.hangPage = 1
    renderSearch()
    search()
    fireEvent.click(await screen.findByRole('button', { name: 'Show 25 more' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 25 more' })).toBeDisabled())
  })
})

describe('when the checking server is offline', () => {
  it('says so and turns Add and Upload off', async () => {
    gateway.online = false
    gateway.pages.push({ total: 2, results: [paper(0), paper(1, { downloadable: false })] })
    renderSearch()
    search()
    await results()
    expect(screen.getByText(/The checking server is offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Paper 0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload the PDF of Paper 1' })).toBeDisabled()
  })
})

describe('after an empty search', () => {
  it('looks at the next 25 when the rank filter hid everything on the page', async () => {
    gateway.pages.push({ total: 60, results: [], hidden: 25 }, { total: 60, results: [paper(0)], hidden: 0 })
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'Q1 / A*' }))
    search()
    expect(await screen.findByText('The venue rank filter hid all 25 papers Scopus sent so far.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Look at the next 25' }))
    await results()
    expect(gateway.searches[1].get('page')).toBe('1')
  })

  it('offers to search the years from 2010, words dropped, or any rank', async () => {
    gateway.pages.push({ total: 0, results: [] }, { total: 0, results: [] })
    renderSearch()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late interaction' } })
    search()
    fireEvent.click(await screen.findByRole('button', { name: /^Search 2010 to / }))
    await waitFor(() => expect(gateway.searches).toHaveLength(2))
    expect(gateway.searches[1].get('since')).toBe('2010')
    expect(screen.getByLabelText('From year')).toHaveValue(2010)
  })

  it('searches without the words', async () => {
    gateway.pages.push({ total: 0, results: [] }, { total: 0, results: [] })
    renderSearch()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late interaction' } })
    search()
    fireEvent.click(await screen.findByRole('button', { name: 'Search without the words' }))
    await waitFor(() => expect(gateway.searches[1].get('q')).toBe(''))
  })

  it('does not offer an earlier start when the search already begins in 1990', async () => {
    gateway.pages.push({ total: 0, results: [] })
    renderSearch()
    fireEvent.change(screen.getByLabelText('From year'), { target: { value: '1990' } })
    search()
    await screen.findByText('Scopus has no open-access papers for that.')
    expect(screen.queryByRole('button', { name: /^Search 2010 to / })).not.toBeInTheDocument()
  })

  it('goes back to any venue rank, and to all of Scopus', async () => {
    gateway.pages.push({ total: 0, results: [] }, { total: 0, results: [] }, { total: 0, results: [] })
    renderSearch()
    fireEvent.click(screen.getByRole('radio', { name: 'Q1–Q2 / A*–A' }))
    search()
    fireEvent.click(await screen.findByRole('button', { name: 'Any venue rank' }))
    await waitFor(() => expect(gateway.searches[1].getAll('rank')).toEqual([]))
    fireEvent.click(await screen.findByRole('button', { name: 'Search all of Scopus' }))
    await waitFor(() => expect(gateway.searches[2].get('scope')).toBe('all'))
  })
})
