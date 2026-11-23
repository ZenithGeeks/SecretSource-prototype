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
  tools: [] as { path: string; body: unknown }[],
  toolResult: {} as Record<string, unknown>,
  events: [] as unknown[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/labeling/sessions/')) return gateway.session
    if (path.startsWith('/agent/tools/')) {
      gateway.tools.push({ path, body: JSON.parse(String(init?.body)) })
      return gateway.toolResult
    }
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
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

import { LabelerApp } from '../src/roles/labeler/LabelerApp'

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

/** Opens the paper's workspace and the toolbar's Ask, which starts on "This claim" there. */
async function openAsk() {
  window.history.replaceState(null, '', '?role=labeler&analysis=a1')
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LabelerApp />
    </QueryClientProvider>,
  )
  await screen.findByText('Method Y improves recall.')
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
  await screen.findByRole('button', { name: 'Review' })
}

describe('Ask AI in the labeler', () => {
  beforeEach(() => {
    gateway.session.saved = { claims: [], candidates: [], labels: [] }
    gateway.streamed = []
    gateway.tools = []
    gateway.events = []
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('is the toolbar’s Ask, with this claim, Answer and Do it, and Do it asks the Labeler’s agent', async () => {
    await openAsk()
    const modes = screen.getByRole('group', { name: 'What Ask does' })
    expect(within(modes).getAllByRole('button').map((button) => button.textContent)).toEqual(['Answer', 'This claim', 'Do it'])
    expect(within(modes).getByRole('button', { name: 'This claim' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(modes).getByRole('button', { name: 'Do it' }))
    const field = screen.getByRole('textbox', { name: 'What should the AI do?' })
    fireEvent.change(field, { target: { value: 'Open the papers list' } })
    fireEvent.submit(field.closest('form') as HTMLFormElement)

    await waitFor(() => expect(gateway.streamed.at(-1)).toMatchObject({ path: '/agent/runs', body: { role: 'labeler', screen: 'workspace' } }))
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

  it('shows the question apart from the answer, a count, and a badge and page for each statement', async () => {
    gateway.events = [
      { type: 'statement', index: 0, text: 'It reports recall on MS MARCO.', source: 'paperA.pdf', page: 5 },
      { type: 'verdict', index: 0, verdict: 'supports', quote: 'recall rose by 4 points', reasoning: 'Table 2.' },
      { type: 'statement', index: 1, text: 'It reports speed on BEIR.', source: 'paperA.pdf', page: 7 },
      { type: 'verdict', index: 1, verdict: 'refutes', quote: '', reasoning: 'BEIR is not measured.' },
      { type: 'statement', index: 2, text: 'It names no baseline.', source: 'paperA.pdf' },
      { type: 'done', statements: 3 },
    ]
    await openAsk()
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What does it report?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('You asked')).toBeInTheDocument()
    expect(screen.getByText('What does it report?')).toBeInTheDocument()
    expect(await screen.findByText('1 of 3 backed · 1 contradicted')).toBeInTheDocument()
    const list = screen.getByText('It reports recall on MS MARCO.').closest('ol') as HTMLElement
    const [backed, contradicted, unchecked] = within(list).getAllByRole('listitem')
    expect(backed).toHaveTextContent(/It reports recall on MS MARCO\.BackedPage 5/)
    expect(contradicted).toHaveTextContent(/Contradicted.*Page 7/)
    // The answer ended before this one was checked, so it says so instead of "Checking…".
    expect(unchecked).toHaveTextContent('Not checked')
    expect(within(backed).getByText('What the passage says')).toBeInTheDocument()
    expect(within(backed).getByText('“recall rose by 4 points”')).toBeInTheDocument()
  })

  it('asks about one passage, with the claim as reworded, from the passage card', async () => {
    gateway.session.saved = {
      ...SAVED,
      claims: [{ claim_id: 'paperA#0', origin: 'extracted', status: 'edited', claim_edited: 'Y raises recall by 4 points.' }],
    }
    // Ask was last closed and left on Do it: the card's button still opens it on this claim.
    window.localStorage.clear()
    window.history.replaceState(null, '', '?role=labeler&analysis=a1')
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LabelerApp />
      </QueryClientProvider>,
    )
    const [first] = await screen.findAllByRole('button', { name: 'Ask AI about this passage' })
    fireEvent.click(first)

    const modes = await screen.findByRole('group', { name: 'What Ask does' })
    expect(within(modes).getByRole('button', { name: 'This claim' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('#1 Ref B · p.5')).toBeInTheDocument()
    expect(screen.queryByLabelText('About')).not.toBeInTheDocument()
    const field = screen.getByLabelText('Question')
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: 'Does it back the claim?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() =>
      expect(gateway.streamed[0]).toEqual({
        path: '/labeling/sessions/a1/ask',
        body: { question: 'Does it back the claim?', reference_id: 'refB', passage: 'recall rose by 4 points', claim: 'Y raises recall by 4 points.' },
      }),
    )

    // Clearing the passage goes back to asking a whole paper.
    fireEvent.click(screen.getByRole('button', { name: 'Stop asking about this passage' }))
    expect(screen.getByLabelText('About')).toHaveValue('')
  })

  it('runs a /command on the open paper, and says what is wrong with one that cannot run', async () => {
    gateway.toolResult = { claims: 2, saved: 1, reviewed: 0, next_unsaved: { number: 2, claim: 'Method Z is faster.', passages: [] } }
    await openAsk()
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: '/labeling_progress' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByRole('progressbar', { name: 'Claims saved' })).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByText('Method Z is faster.')).toBeInTheDocument()
    expect(gateway.tools).toEqual([{ path: '/agent/tools/labeling_progress', body: { analysis_id: 'a1' } }])

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: '/nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText(/There is no \/nope command/)).toBeInTheDocument()
    expect(gateway.tools).toHaveLength(1)
  })
})
