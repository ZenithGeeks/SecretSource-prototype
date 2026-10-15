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
      { claim_id: 'paperA#1', claim: 'Y is fast.', sentence: '', section: '', source: null, candidates: [] },
    ],
    references: [{ reference_id: 'refB', file: 'refB.pdf', label: 'Ref B' }],
    saved: { claims: [], candidates: [], labels: [] },
    others: {},
  },
  posts: [] as unknown[],
  failSaves: false,
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (gateway.failSaves) throw new Error('503: not set up')
      gateway.posts.push(JSON.parse(String(init.body)))
      return { claims: 1, candidates: 2, labels: 1 }
    }
    if (path.startsWith('/labeling/sessions/')) return gateway.session
    throw new Error(`unexpected ${path}`)
  }),
  fetchFile: vi.fn(),
  api: { findInPaper: vi.fn(async () => ({ page: null, boxes: [] })) },
}))
vi.mock('../src/components/PageViewer', () => ({
  PageViewer: ({
    target,
    onSelectText,
  }: {
    target: { paper: string; quote?: string }
    onSelectText?: (s: { text: string; page: number | null }) => void
  }) => (
    <div>
      <div data-testid="viewer">{target.paper}|{target.quote}</div>
      <button type="button" onClick={() => onSelectText?.({ text: `picked in ${target.paper}`, page: 4 })}>
        select in {target.paper}
      </button>
    </div>
  ),
}))

import {
  buildSave,
  draftFromSaved,
  emptyDraft,
  isDone,
  remaining,
  type Draft,
  type WorkClaim,
} from '../src/lib/labeling'
import { Workspace } from '../src/roles/labeler/screens/Workspace'

const claim: WorkClaim = { ...gateway.session.claims[0], origin: 'extracted' }
const refs = gateway.session.references
const judged = (over: Partial<Draft>): Draft => ({ ...emptyDraft(), ...over })

describe('what is left to decide', () => {
  it('asks for a decision on the claim first', () => {
    expect(remaining(claim, emptyDraft(), refs)).toEqual(['Decide on the claim: keep, edit or reject it'])
  })

  it('is finished at once for a rejected claim', () => {
    expect(isDone(claim, judged({ status: 'rejected' }), refs)).toBe(true)
  })

  it('wants every passage judged and every reference with a relevant passage labeled', () => {
    const d = judged({ status: 'accepted', cands: { c1: 'relevant' } })
    expect(remaining(claim, d, refs)).toEqual(['1 passage not judged', 'Give Ref B a level'])
    const done = judged({
      status: 'accepted',
      cands: { c1: 'relevant', c2: 'rejected' },
      labels: { refB: { evidence: 3, rationale: '', confidence: 'medium' } },
    })
    expect(isDone(claim, done, refs)).toBe(true)
  })

  it('wants the new wording of an edited claim', () => {
    expect(remaining(claim, judged({ status: 'edited', cands: { c1: 'rejected', c2: 'rejected' } }), refs)).toEqual([
      'Write the edited claim',
    ])
    const unchanged = judged({ status: 'edited', edited: claim.claim, cands: { c1: 'rejected', c2: 'rejected' } })
    expect(remaining(claim, unchanged, refs)).toEqual(['Write the edited claim'])
  })
})

describe('what is saved', () => {
  const d = judged({
    status: 'edited',
    edited: ' Y raises recall. ',
    cands: { c1: 'relevant', c2: 'rejected' },
    added: [{ reference_id: 'refB', page: 7, passage: 'table 2 shows it' }],
    labels: { refB: { evidence: 4, rationale: ' pooled ', confidence: 'high' } },
  })

  it('sends judged passages by id only, plus the label with the relevant passages as its quotes', () => {
    const save = buildSave(claim, d)
    expect(save.claims[0]).toMatchObject({ status: 'edited', claim_edited: 'Y raises recall.', origin: 'extracted' })
    expect(save.candidates.filter((c) => c.origin === 'retrieved')).toEqual([
      expect.objectContaining({ cand_id: 'c1', status: 'relevant', passage: '' }),
      expect.objectContaining({ cand_id: 'c2', status: 'rejected', passage: '' }),
    ])
    expect(save.candidates.find((c) => c.origin === 'human_added')).toMatchObject({ page: 7, passage: 'table 2 shows it' })
    expect(save.labels).toEqual([
      { claim_id: 'paperA#0', reference_id: 'refB', evidence: 4, rationale: 'pooled', confidence: 'high',
        spans: ['recall rose by 4 points', 'table 2 shows it'] },
    ])
  })

  it('saves only the claim when it is rejected', () => {
    const save = buildSave(claim, { ...d, status: 'rejected' })
    expect([save.claims.length, save.candidates.length, save.labels.length]).toEqual([1, 0, 0])
  })

  it('retracts a passage that was added, saved, then removed', () => {
    const before = d
    const after = { ...d, added: [] }
    expect(buildSave(claim, after, before).candidates.at(-1)).toMatchObject({
      origin: 'human_added', status: 'rejected', passage: 'table 2 shows it',
    })
  })

  it('carries on from what was saved earlier', () => {
    const back = draftFromSaved(claim, {
      claims: [{ claim_id: 'paperA#0', status: 'edited', claim_edited: 'Y raises recall.' }],
      candidates: [
        { claim_id: 'paperA#0', origin: 'retrieved', cand_id: 'c1', status: 'relevant' },
        { claim_id: 'paperA#0', origin: 'human_added', reference_id: 'refB', page: '7', passage: 'table 2 shows it', status: 'relevant' },
      ],
      labels: [{ claim_id: 'paperA#0', reference_id: 'refB', evidence: '4', rationale: 'pooled', confidence: 'high' }],
    })
    expect(back).toMatchObject({ status: 'edited', edited: 'Y raises recall.', cands: { c1: 'relevant' } })
    expect(back.added).toEqual([{ reference_id: 'refB', page: 7, passage: 'table 2 shows it' }])
    expect(back.labels.refB).toMatchObject({ evidence: 4, confidence: 'high' })
  })
})

describe('the workspace', () => {
  beforeEach(() => {
    gateway.posts.length = 0
    gateway.failSaves = false
    window.localStorage.setItem('labeler.paperView', 'both')
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('shows the claim in the paper and a passage in the reference, and saves what the person decided', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    const viewers = screen.getAllByTestId('viewer').map((v) => v.textContent)
    expect(viewers).toEqual(['refB.pdf|recall rose by 4 points', 'paperA.pdf|We show Y improves recall.'])

    expect(screen.getByRole('button', { name: /^Save labels/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const [relevant1, , , notRelevant2] = screen.getAllByRole('radio', { name: /Relevant|Not relevant/ })
    fireEvent.click(relevant1)
    fireEvent.click(notRelevant2)
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    expect(screen.getByText('Every decision for this claim is made.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0]).toMatchObject({
      claims: [{ claim_id: 'paperA#0', status: 'accepted' }],
      candidates: [{ cand_id: 'c1', status: 'relevant' }, { cand_id: 'c2', status: 'rejected' }],
      labels: [{ reference_id: 'refB', evidence: 3, spans: ['recall rose by 4 points'] }],
    })
    expect(await screen.findByText('Saved 4 rows')).toBeInTheDocument()
  })

  it('keys 1-4 label the reference on the right', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" />
      </QueryClientProvider>,
    )
    await screen.findByRole('radiogroup', { name: 'Decision on this claim' })
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.keyDown(window, { key: '4' })
    expect(screen.getByRole('radio', { name: /4 · Strong/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('keys 1-4 do nothing while the reference shown has no relevant passage', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" />
      </QueryClientProvider>,
    )
    await screen.findByRole('radiogroup', { name: 'Decision on this claim' })
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.getByText('Mark a passage relevant to grade this reference')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '4' })
    expect(screen.queryByRole('radio', { name: /4 · Strong/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('radio', { name: /^Not relevant/ })[0]) // judged, but not relevant
    fireEvent.keyDown(window, { key: '4' })
    expect(screen.queryByRole('radio', { name: /4 · Strong/ })).not.toBeInTheDocument()
  })

  const open = async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" />
      </QueryClientProvider>,
    )
    await screen.findByRole('radiogroup', { name: 'Decision on this claim' })
  }

  it('adds text selected in the reference as evidence, with its page', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    expect(screen.getByRole('region', { name: 'Selected text' })).toHaveTextContent('picked in refB.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.queryByRole('region', { name: 'Selected text' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /Not relevant/ })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: /Not relevant/ })[1])
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0]).toMatchObject({
      candidates: expect.arrayContaining([
        { claim_id: 'paperA#0', reference_id: 'refB', cand_id: '', origin: 'human_added', status: 'relevant', page: 4, passage: 'picked in refB.pdf' },
      ]),
      labels: [{ reference_id: 'refB', evidence: 3, spans: ['picked in refB.pdf'] }],
    })
  })

  it('files selected text under the paper it was selected in, even if the right pane moved on', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0]) // moves the right pane's focus
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0]).toMatchObject({
      candidates: expect.arrayContaining([expect.objectContaining({ origin: 'human_added', reference_id: 'refB', passage: 'picked in refB.pdf' })]),
    })
  })

  it('jumps between claims from the numbered strip, which says where each one stands', async () => {
    await open()
    expect(screen.getByRole('heading', { name: /Claim 1 of 2/ })).toBeInTheDocument()
    const first = screen.getByRole('button', { name: /^Claim 1, not started/ })
    expect(first).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.getByRole('button', { name: /^Claim 1, in progress, unsaved/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 2, not started/ }))
    expect(await screen.findByRole('heading', { name: /Claim 2 of 2/ })).toBeInTheDocument()
  })

  it('keeps an unsaved claim as a draft when moving to another, and writes nothing', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Claim 2, not started/ }))
    expect(await screen.findByRole('heading', { name: /Claim 2 of 2/ })).toBeInTheDocument()
    expect(gateway.posts).toHaveLength(0)
    // Claim 1 stays flagged, and its decisions are still there when it is opened again.
    fireEvent.click(screen.getByRole('button', { name: /^Claim 1, in progress, unsaved/ }))
    expect(await screen.findByRole('heading', { name: /Claim 1 of 2/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio', { name: /^Relevant/ })[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('does not type the shortcut letter into the edit box that E opens', async () => {
    await open()
    const typed = fireEvent.keyDown(window, { key: 'e' }) // false when the default was prevented
    expect(typed).toBe(false)
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('The claim, as it should read')).toHaveValue('Method Y improves recall.')
  })

  it('does not count a finished claim as finished until it is saved', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: /^Not relevant/ })[1])
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    expect(screen.getByText('Every decision for this claim is made.')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 claims finished')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim 1, in progress, unsaved/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    expect(await screen.findByText('1 of 2 claims finished')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim 1, finished:/ })).toBeInTheDocument()
  })

  it('judges the focused passage with R and N, moves on to the next unjudged one, and decides the claim with K, E, X', async () => {
    await open()
    const shown = () => screen.getAllByTestId('viewer')[0].textContent
    fireEvent.keyDown(window, { key: 'k' })
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
    expect(shown()).toBe('refB.pdf|recall rose by 4 points')
    fireEvent.keyDown(window, { key: 'r' })
    expect(screen.getAllByRole('radio', { name: /^Relevant/ })[0]).toHaveAttribute('aria-checked', 'true')
    expect(shown()).toBe('refB.pdf|unrelated text') // focus moved on
    fireEvent.keyDown(window, { key: 'n' })
    expect(screen.getAllByRole('radio', { name: /^Not relevant/ })[1]).toHaveAttribute('aria-checked', 'true')
    expect(shown()).toBe('refB.pdf|unrelated text') // nothing left unjudged: focus stays
    fireEvent.keyDown(window, { key: 'u' })
    expect(shown()).toBe('refB.pdf|recall rose by 4 points')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(shown()).toBe('refB.pdf|unrelated text')

    fireEvent.keyDown(window, { key: 'e' })
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.getByRole('radio', { name: /Reject/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('ignores the shortcut keys while typing in a field', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Edit/ }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'x' })
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('moves between claims with ] and [', async () => {
    await open()
    fireEvent.keyDown(window, { key: ']' })
    expect(await screen.findByRole('heading', { name: /Claim 2 of 2/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true })
    expect(await screen.findByRole('heading', { name: /Claim 1 of 2/ })).toBeInTheDocument()
  })

  it('tells the app whether there are unsaved labels', async () => {
    const onDirtyChange = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" onDirtyChange={onDirtyChange} />
      </QueryClientProvider>,
    )
    await screen.findByRole('radiogroup', { name: 'Decision on this claim' })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })

  it('shows each reference as one section, with its passages and then its level form', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const section = screen.getByRole('region', { name: 'Ref B' })
    expect(within(section).getAllByRole('radiogroup', { name: /^Passage/ })).toHaveLength(2)
    expect(within(section).getByText('Mark a passage relevant to grade this reference')).toBeInTheDocument()
    fireEvent.click(within(section).getAllByRole('radio', { name: /^Relevant/ })[0])
    expect(within(section).getByRole('radiogroup', { name: 'Support level for Ref B' })).toBeInTheDocument()
  })

  it('shows the focused passage in full and clamps the others', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const first = screen.getByText('recall rose by 4 points')
    const second = screen.getByText('unrelated text')
    expect(first).not.toHaveClass('line-clamp-3')
    expect(second).toHaveClass('line-clamp-3')
  })

  it('starts with the reference alone when no choice is stored, at any width', async () => {
    window.localStorage.removeItem('labeler.paperView')
    await open()
    expect(screen.getAllByTestId('viewer').map((v) => v.textContent)).toEqual(['refB.pdf|recall rose by 4 points'])
  })

  it('shows the reference alone, and remembers the choice', async () => {
    await open()
    expect(screen.getAllByTestId('viewer')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Reference only' }))
    expect(screen.getAllByTestId('viewer').map((v) => v.textContent)).toEqual(['refB.pdf|recall rose by 4 points'])
    expect(window.localStorage.getItem('labeler.paperView')).toBe('reference')
    fireEvent.click(screen.getByRole('button', { name: 'Both papers' }))
    expect(screen.getAllByTestId('viewer')).toHaveLength(2)
    window.localStorage.removeItem('labeler.paperView')
  })

  it('lists what every level means under the picker, with the chosen one marked', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    const rubric = screen.getByRole('list', { name: 'What each level means' })
    expect(within(rubric).getAllByRole('listitem')).toHaveLength(4)
    expect(within(rubric).getByText(/The passage backs the claim, with a gap in scope or detail\./)).toBeInTheDocument()
    expect(within(rubric).queryByRole('listitem', { current: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '3 · Clear' }))
    expect(within(rubric).getByRole('listitem', { current: true })).toHaveTextContent(/^3 Clear/)
    expect(screen.getByText('Level 3, Clear: The passage backs the claim, with a gap in scope or detail.')).toBeInTheDocument()
  })

  it('keeps an undecided claim when evidence is added to it', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('region', { name: 'Selected text' })).not.toBeInTheDocument()
  })

  it('will not add evidence to a rejected claim, and says why', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }))
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    expect(screen.getByRole('button', { name: 'Add as evidence' })).toBeDisabled()
    expect(screen.getByText('This claim is rejected. Keep or edit it to add evidence.')).toBeInTheDocument()
    // The note is a full-width line; without wrap it squeezes the quote to 0px in the row layout.
    expect(screen.getByRole('region', { name: 'Selected text' })).toHaveClass('sm:flex-row', 'sm:flex-wrap')
  })

  it('uses text selected in the paper as the claim wording, or as a new claim', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: "Use as this claim's wording" }))
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByDisplayValue('picked in paperA.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new claim' }))
    expect(screen.getByText(/· added/)).toBeInTheDocument()
  })
})
