/** Ask AI in the labeler: the review runs only on a saved claim, points the cursor at each
 * finding and never changes a label; a question goes to the chosen paper. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  session: {
    analysis_id: 'a1',
    paper_id: 'paperA',
    paper_file: 'paperA.pdf',
    title: 'Paper A',
    annotator: 'chanya',
    claims: [
      {
        claim_id: 'paperA#0',
        claim: 'Method Y improves recall.',
        sentence: 'We show Y improves recall.',
        section: '3',
        source: null,
        candidates: [
          { cand_id: 'c1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 1, score: 9.1, page: 5, passage: 'recall rose by 4 points' },
          { cand_id: 'c2', reference_id: 'refB', reference_file: 'refB.pdf', rank: 2, score: 3, page: 2, passage: 'unrelated text' },
        ],
      },
    ],
    references: [{ reference_id: 'refB', file: 'refB.pdf', label: 'Ref B', ref: 'b4', authors: [], year: '2021' }],
    saved: { claims: [] as Record<string, string>[], candidates: [] as Record<string, string>[], labels: [] as Record<string, string>[] },
    others: {},
  },
  streamed: [] as { path: string; body: unknown }[],
  events: [] as unknown[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string) => {
    if (path.startsWith('/labeling/sessions/')) return gateway.session
    throw new Error(`unexpected ${path}`)
  }),
  postEvents: vi.fn(async (path: string, body: unknown, onEvent: (event: unknown) => void) => {
    gateway.streamed.push({ path, body })
    for (const event of gateway.events) onEvent(event)
  }),
  fetchFile: vi.fn(),
  api: { findInPaper: vi.fn(async () => ({ page: null, boxes: [] })) },
}))
vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => null }))

import { Workspace } from '../src/roles/labeler/screens/Workspace'

const SAVED = {
  claims: [{ claim_id: 'paperA#0', origin: 'extracted', status: 'accepted', claim_edited: '' }],
  candidates: [
    { claim_id: 'paperA#0', cand_id: 'c1', reference_id: 'refB', origin: 'retrieved', status: 'relevant', passage: '', page: '5' },
    { claim_id: 'paperA#0', cand_id: 'c2', reference_id: 'refB', origin: 'retrieved', status: 'rejected', passage: '', page: '2' },
  ],
  labels: [{ claim_id: 'paperA#0', reference_id: 'refB', evidence: '4', rationale: '', confidence: 'medium' }],
}

const QUESTION = {
  type: 'finding',
  target: { kind: 'reference', id: 'refB' },
  tone: 'asks',
  text: 'The judge reads these passages as not settling the claim, for the whole claim. Does level 4 hold for the part this paper is cited for?',
}

async function openAsk() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Workspace analysisId="a1" />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
}

describe('Ask AI in the labeler', () => {
  beforeEach(() => {
    gateway.session.saved = { claims: [], candidates: [], labels: [] }
    gateway.streamed = []
    gateway.events = []
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('reviews only a claim that is saved, with no unsaved changes', async () => {
    await openAsk()
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
    expect(screen.getByText(/Save this claim first/)).toBeInTheDocument()
  })

  it('lists what the review found, points the cursor at it, and leaves the labels as they are', async () => {
    gateway.session.saved = SAVED
    gateway.events = [QUESTION, { type: 'done', findings: 1 }]
    await openAsk()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(await screen.findByText(QUESTION.text)).toBeInTheDocument()
    expect(gateway.streamed[0]).toEqual({ path: '/labeling/sessions/a1/review', body: { claim_id: 'paperA#0' } })
    // The finding names what it is about; the cursor shows the same reaction beside the reference.
    expect(screen.getByText(/· Ref B/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('A question')).toHaveLength(2))
    // Nothing changed: level 4 is still chosen, and there is nothing new to save.
    const levels = screen.getByRole('radiogroup', { name: /level/i })
    expect(within(levels).getByRole('radio', { name: /^4/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(/Save your changes first/)).not.toBeInTheDocument()
  })

  it('asks a question about a reference the claim cites', async () => {
    gateway.events = [
      { type: 'statement', index: 0, text: 'B reports recall on MS MARCO.', source: 'refB.pdf', page: 5 },
      { type: 'verdict', index: 0, verdict: 'supports', quote: '', reasoning: '' },
      { type: 'done', statements: 1 },
    ]
    await openAsk()
    fireEvent.change(screen.getByLabelText('About'), { target: { value: 'refB' } })
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Where does B report recall?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText(/B reports recall on MS MARCO\./)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Backed/)).toBeInTheDocument())
    expect(gateway.streamed[0]).toEqual({
      path: '/labeling/sessions/a1/ask',
      body: { question: 'Where does B report recall?', reference_id: 'refB' },
    })
  })
})
