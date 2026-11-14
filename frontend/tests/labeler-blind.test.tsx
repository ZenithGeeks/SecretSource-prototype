/** Blind checks (#867): the person's own list, and the lead's form that hands them out. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  puts: [] as { path: string; body: unknown }[],
  pool: {} as Record<string, unknown>,
}))

const paper = (id: string, title: string, topic: string, labelers: string[], judged = 0) => ({
  analysis_id: id,
  title,
  topic,
  claims: 4,
  judged,
  team_judged: labelers.length ? 4 : 0,
  labelers,
  status: 'done',
  reason: '',
  mine: false,
  added_by: 'Somchai',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
})

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      gateway.puts.push({ path, body: JSON.parse(String(init.body)) })
      return {}
    }
    if (path === '/labeling/pool') return gateway.pool
    throw new Error(`unexpected ${path}`)
  }),
}))

import { BlindChecks } from '../src/roles/labeler/screens/BlindChecks'

const onOpen = vi.fn()

function renderBlind() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BlindChecks onOpen={onOpen} />
    </QueryClientProvider>,
  )
}

describe('blind checks', () => {
  beforeEach(() => {
    gateway.puts.length = 0
    onOpen.mockReset()
    gateway.pool = {
      topics: ['CV', 'NLP'],
      me: 'Chanya',
      lead: false,
      people: [
        { name: 'Chanya', topic: 'NLP' },
        { name: 'Somchai', topic: 'CV' },
      ],
      papers: [paper('cv1', 'A CV paper', 'CV', ['Somchai'], 1), paper('nlp1', 'An NLP paper', 'NLP', ['Chanya'])],
      blind: ['cv1'],
      blind_checks: [],
    }
  })

  it('lists only the papers the person checks blind, and opens one', async () => {
    renderBlind()
    const list = await screen.findByRole('list')
    expect(within(list).getByText('A CV paper')).toBeInTheDocument()
    expect(within(list).queryByText('An NLP paper')).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Continue' }))
    expect(onOpen).toHaveBeenCalledWith('cv1')
    expect(screen.queryByText('Assign blind checks')).not.toBeInTheDocument() // not a lead
  })

  it('says when there is nothing to check', async () => {
    gateway.pool = { ...gateway.pool, blind: [] }
    renderBlind()
    expect(await screen.findByText('No blind checks for you')).toBeInTheDocument()
  })

  it('lets a lead assign a paper, but not to someone who already labeled it', async () => {
    gateway.pool = { ...gateway.pool, lead: true }
    renderBlind()
    const person = await screen.findByLabelText('Person')
    const chosenPaper = screen.getByLabelText('Paper')
    fireEvent.change(person, { target: { value: 'Chanya' } })
    fireEvent.change(chosenPaper, { target: { value: 'nlp1' } })
    expect(screen.getByText('Chanya already labeled this paper, so it cannot be a blind check for them.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()

    fireEvent.change(person, { target: { value: 'Somchai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await vi.waitFor(() => expect(gateway.puts).toEqual([{ path: '/labeling/blind', body: { name: 'Somchai', analysis_id: 'nlp1', on: true } }]))
  })

  it('groups papers by topic, rules out the ones a person cannot take, and counts what each has', async () => {
    gateway.pool = {
      ...gateway.pool,
      lead: true,
      papers: [
        paper('cv1', 'A CV paper', 'CV', ['Somchai']),
        paper('nlp1', 'An NLP paper', 'NLP', ['Chanya']),
        paper('hpc1', 'An HPC paper', 'HPC', ['Nuttadon']),
      ],
      blind_checks: [
        { name: 'Somchai', analysis_id: 'nlp1' },
        { name: 'Chanya', analysis_id: 'hpc1' },
        { name: 'Chanya', analysis_id: 'cv1' },
      ],
    }
    renderBlind()
    const person = await screen.findByLabelText('Person')
    expect(within(person).getByRole('option', { name: 'Somchai (CV) · 1 assigned' })).toBeInTheDocument()

    fireEvent.change(person, { target: { value: 'Somchai' } })
    const papers = screen.getByLabelText('Paper')
    expect(within(papers).getByRole('option', { name: 'A CV paper (already labeled)' })).toBeDisabled()
    expect(within(papers).getByRole('option', { name: 'An NLP paper (already assigned)' })).toBeDisabled()
    const open = within(papers).getByRole('option', { name: 'An HPC paper' })
    expect(open).toBeEnabled()
    expect(open.parentElement).toHaveAttribute('label', 'Other') // HPC is not in this pool's topics

    // Sorted by person, then by title within a person.
    const rows = within(screen.getByRole('table', { name: 'Assigned (3)' })).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual(['ChanyaCVA CV paper', 'ChanyaHPCAn HPC paper', 'SomchaiNLPAn NLP paper'])
  })
})
