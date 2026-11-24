/** The read-only Labels screen of one paper, and which papers in the list open it. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  compare: null as unknown,
  note: 'ok' as 'ok' | 'fail',
  posts: [] as unknown[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/labeling/compare/a1/notes') {
      gateway.posts.push(JSON.parse(String(init?.body)))
      if (gateway.note === 'fail') throw new Error('404: no such pair')
      return { author: 'Chanya', ts: '2026-11-23T07:00:00+00:00', note: 'x' }
    }
    if (path === '/labeling/compare/a1') {
      if (gateway.compare instanceof Error) throw gateway.compare
      return gateway.compare
    }
    throw new Error(`unexpected ${path}`)
  }),
}))

import type { ComparePair, Pool } from '../src/lib/labeling'
import { opensLabels } from '../src/roles/labeler/paperFilters'
import { Labels } from '../src/roles/labeler/screens/Labels'

const pair = (over: Partial<ComparePair> = {}): ComparePair => ({
  claim_id: 'p#0',
  reference_id: 'refB',
  claim: 'Method Y improves recall.',
  reference_title: 'Ref B',
  agree: false,
  verdicts: [
    { labeler: 'Chanya', evidence: 3, confidence: 'high', rationale: 'Only partly.', claim_status: 'accepted' },
    { labeler: 'Somchai', evidence: null, confidence: '', rationale: '', claim_status: 'rejected' },
  ],
  notes: [],
  ...over,
})

const comparison = (pairs: ComparePair[], labelers = ['Chanya', 'Somchai']) => ({ paper_id: 'p', title: 'Paper A', labelers, pairs })

function renderLabels() {
  const onBack = vi.fn()
  const onLabel = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Labels analysisId="a1" onBack={onBack} onLabel={onLabel} />
    </QueryClientProvider>,
  )
  return { onBack, onLabel }
}

beforeEach(() => {
  gateway.compare = null
  gateway.note = 'ok'
  gateway.posts.length = 0
})

describe('Labels', () => {
  it('groups the pairs and shows each labeler, with a rejected claim and no confidence spelled out', async () => {
    gateway.compare = comparison([
      pair(),
      pair({ claim_id: 'p#1', claim: '', agree: true, verdicts: [
        { labeler: 'Chanya', evidence: 4, confidence: '', rationale: '', claim_status: 'accepted' },
        { labeler: 'Somchai', evidence: 4, confidence: 'low', rationale: '', claim_status: 'accepted' },
      ] }),
      pair({ claim_id: 'p#2', verdicts: [{ labeler: 'Somchai', evidence: 1, confidence: 'medium', rationale: '', claim_status: 'accepted' }] }),
    ])
    const { onBack, onLabel } = renderLabels()

    expect(await screen.findByRole('heading', { name: 'Paper A' })).toBeInTheDocument()
    expect(screen.getByText('Labeled by Chanya, Somchai. 3 pairs, 1 with a disagreement.')).toBeInTheDocument()
    const disagree = screen.getByRole('region', { name: 'Labelers disagree (1)' })
    expect(within(disagree).getByText('3 · Clear')).toBeInTheDocument()
    expect(within(disagree).getByText('high confidence')).toBeInTheDocument()
    expect(within(disagree).getByText('Only partly.')).toBeInTheDocument()
    expect(within(disagree).getByText('Rejected the claim')).toBeInTheDocument()
    const agree = screen.getByRole('region', { name: 'Labelers agree (1)' })
    expect(within(agree).getByText('(no claim text)')).toBeInTheDocument()
    expect(within(agree).getAllByText('4 · Strong')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'One labeler so far (1)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to papers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Label it yourself' }))
    expect([onBack.mock.calls.length, onLabel.mock.calls.length]).toEqual([1, 1])
  })

  it('says so when nobody has saved a level, and leaves out a missing labeler line', async () => {
    gateway.compare = comparison([], [])
    renderLabels()
    expect(await screen.findByText('No labels yet')).toBeInTheDocument()
    expect(screen.getByText('0 pairs, 0 with a disagreement.')).toBeInTheDocument()
  })

  it('counts one pair in the singular', async () => {
    gateway.compare = comparison([pair()])
    renderLabels()
    expect(await screen.findByText('Labeled by Chanya, Somchai. 1 pair, 1 with a disagreement.')).toBeInTheDocument()
  })

  it('asks the viewer to label the paper first on 403, and offers to start', async () => {
    gateway.compare = new Error('403: label this paper before comparing it')
    const { onLabel } = renderLabels()
    expect(await screen.findByText('Label this paper first')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Label this paper' }))
    expect(onLabel).toHaveBeenCalled()
  })

  it('names any other error', async () => {
    gateway.compare = new Error('404: gone')
    renderLabels()
    expect(await screen.findByText('This paper is not available')).toBeInTheDocument()
  })

  it('shows the notes on a pair and adds one, clearing the box once saved', async () => {
    gateway.compare = comparison([pair({ notes: [{ author: 'Somchai', ts: '2026-11-23T06:00:00+00:00', note: 'The passage is about precision.' }] })])
    renderLabels()
    expect(await screen.findByText('The passage is about precision.')).toBeInTheDocument()
    const box = screen.getByLabelText('Note on this pair')
    const add = screen.getByRole('button', { name: 'Add note' })
    expect(add).toBeDisabled()
    fireEvent.submit(box.closest('form')!) // an empty note is not sent
    fireEvent.change(box, { target: { value: '  Agree it is level 2.  ' } })
    fireEvent.click(add)
    await waitFor(() => expect(box).toHaveValue(''))
    expect(gateway.posts).toEqual([{ claim_id: 'p#0', reference_id: 'refB', note: 'Agree it is level 2.' }])
  })

  it('keeps the note and says why when it is not saved', async () => {
    gateway.compare = comparison([pair()])
    gateway.note = 'fail'
    renderLabels()
    const box = await screen.findByLabelText('Note on this pair')
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The note was not saved: This paper is not available.')
    expect(box).toHaveValue('x')
  })
})

describe('opensLabels', () => {
  const paper = (over: Partial<Pool['papers'][number]>) =>
    ({ status: 'done', claims: 4, judged: 0, team_judged: 4, ...over }) as Pool['papers'][number]

  it('opens the labels of a paper the team finished, for a lead or someone who finished it', () => {
    expect(opensLabels(paper({}), true)).toBe(true)
    expect(opensLabels(paper({ judged: 4 }), false)).toBe(true)
    expect(opensLabels(paper({}), false)).toBe(false)
    expect(opensLabels(paper({ team_judged: 3 }), true)).toBe(false)
  })
})
