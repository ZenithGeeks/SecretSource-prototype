import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    references: [{ reference_id: 'refB', file: 'refB.pdf', label: 'Ref B', ref: 'b4', authors: ['Ana Silva', 'Bo Lee'], year: '2021' }],
    saved: { claims: [], candidates: [], labels: [] },
    others: {},
  },
  posts: [] as unknown[],
  failSaves: false,
  // The live search for a claim added by hand: what it returns, and what it was asked.
  searched: [] as unknown[],
  found: [] as unknown[],
  failSearch: false,
  pool: {
    topics: ['NLP'],
    me: 'chanya',
    people: [{ name: 'chanya', topic: 'NLP' }],
    papers: [
      { analysis_id: 'a1', title: 'Paper A', topic: 'NLP', claims: 2, judged: 0, team_judged: 0, labelers: ['chanya'], status: 'done', reason: '', mine: true, added_by: 'chanya', subject: '', keywords: [], venue_rank: '', venue_rank_source: '' },
      { analysis_id: 'a2', title: 'Paper B', topic: 'NLP', claims: 4, judged: 1, team_judged: 1, labelers: ['chanya'], status: 'done', reason: '', mine: false, added_by: 'nuttadon', subject: '', keywords: [], venue_rank: '', venue_rank_source: '' },
    ],
  },
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/candidates')) {
      gateway.searched.push(JSON.parse(String(init?.body)))
      if (gateway.failSearch) throw new Error('502: retrieval did not answer')
      return { candidates: gateway.found }
    }
    if (init?.method === 'POST') {
      if (gateway.failSaves) throw new Error('503: not set up')
      gateway.posts.push(JSON.parse(String(init.body)))
      return { claims: 1, candidates: 2, labels: 1 }
    }
    if (path === '/labeling/pool') return gateway.pool
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
    markers = [],
    onCitation,
  }: {
    target: { paper: string; quote?: string; label: string; detail?: string; source?: { page: number } | null; paperRole?: string }
    onSelectText?: (s: { text: string; page: number | null }) => void
    markers?: { ref: string; text: string }[]
    onCitation?: (marker: { ref: string; text: string }) => void
  }) => (
    <div>
      <div data-testid="viewer">{target.paper}|{target.quote}</div>
      <p data-testid="viewer-box">{target.paper}: {target.source ? `boxed on page ${target.source.page}` : 'no box'}</p>
      <p data-testid="viewer-heading">{target.label}{target.detail && ` / ${target.detail}`}</p>
      <p data-testid="viewer-role">{target.paperRole}</p>
      <button type="button" onClick={() => onSelectText?.({ text: `picked in ${target.paper}`, page: 4 })}>
        select in {target.paper}
      </button>
      {markers.map((m) => (
        <button key={m.text} type="button" onClick={() => onCitation?.(m)}>
          cite {m.text}
        </button>
      ))}
    </div>
  ),
}))

import {
  bestCandidate,
  buildSave,
  byline,
  cloudflareBlocked,
  draftFromSaved,
  emptyDraft,
  emptyLabel,
  isDone,
  isSavedDone,
  nextPaperInTopic,
  nextUnfinishedIndex,
  problem,
  readConfidence,
  referenceFinished,
  referenceSummary,
  remaining,
  saveNextTarget,
  workClaims,
  type Draft,
  type WorkClaim,
} from '../src/lib/labeling'
import { api } from '../src/lib/api'
import { Workspace } from '../src/roles/labeler/screens/Workspace'

const claim: WorkClaim = { ...gateway.session.claims[0], origin: 'extracted' }
/** The viewers on screen: Reference only keeps the paper's viewer mounted but hidden. */
const shownViewers = () => screen.getAllByTestId('viewer').filter((v) => !v.closest('[hidden]')).map((v) => v.textContent)
const refs = gateway.session.references
const judged = (over: Partial<Draft>): Draft => ({ ...emptyDraft(), ...over })

describe('a failed labeling call', () => {
  const challenge = '403: <!DOCTYPE html><html><title>Just a moment...</title><body>cf-mitigated</body></html>'

  it('shows a reload message for a Cloudflare challenge and keeps a gateway 403 as access', () => {
    expect(cloudflareBlocked(challenge)).toBe(true)
    expect(cloudflareBlocked('403: Just a moment...')).toBe(true)
    expect(cloudflareBlocked('403: {"detail":"this account is not on the labeling team"}')).toBe(false)
    expect(cloudflareBlocked('403: ')).toBe(false)
    expect(problem(new Error(challenge))).toMatchObject({
      title: "The site's protection blocked this request",
    })
    expect(problem(new Error('403: {"detail":"no access"}')).title).toBe("You can't use the labeler")
  })

  it.each([
    '403: <html><body>challenge</body></html>',
    '403: proxy <html><body>challenge</body></html>',
    '403: cf-mitigated',
    '403: challenge-platform',
    '403: /cdn-cgi/challenge',
    '403: Attention required',
  ])('recognizes a protection page marker in %s', (message) => {
    expect(cloudflareBlocked(message)).toBe(true)
  })

  it('leaves valid JSON without a gateway detail as an ordinary denial', () => {
    expect(cloudflareBlocked('403: {"error":"denied"}')).toBe(false)
  })
})

describe('what is left to decide', () => {
  it('asks for a decision on the claim first', () => {
    expect(remaining(claim, emptyDraft(), refs)).toEqual(['Decide on the claim: keep, edit or reject it'])
  })

  it('is finished at once for a rejected claim', () => {
    expect(isDone(claim, judged({ status: 'rejected' }), refs)).toBe(true)
  })

  it('wants every passage judged and every reference with a relevant passage labeled', () => {
    const d = judged({ status: 'accepted', cands: { c1: 'relevant' } })
    expect(remaining(claim, d, refs)).toEqual(['1 passage not judged', 'Give Silva, Lee · 2021 a level'])
    const done = judged({
      status: 'accepted',
      cands: { c1: 'relevant', c2: 'rejected' },
      labels: { refB: { evidence: 3, rationale: '', confidence: 'medium' } },
    })
    expect(isDone(claim, done, refs)).toBe(true)
  })

  it('does not treat an unset confidence as Medium', () => {
    expect(emptyLabel().confidence).toBeNull()
    const leveled = judged({
      status: 'accepted',
      cands: { c1: 'relevant', c2: 'rejected' },
      labels: { refB: { evidence: 3, rationale: '', confidence: null } },
    })
    expect(remaining(claim, leveled, refs)).toEqual(['Give Silva, Lee · 2021 a confidence'])
    expect(buildSave(claim, leveled).labels[0].confidence).toBe('')
    expect(readConfidence('')).toBeNull()
    expect(readConfidence(undefined)).toBe('medium')
    expect(readConfidence('high')).toBe('high')
    const back = draftFromSaved(claim, {
      claims: [],
      candidates: [],
      labels: [
        { claim_id: 'paperA#0', reference_id: 'refB', evidence: '3', rationale: '', confidence: '' },
        { claim_id: 'paperA#0', reference_id: 'refOld', evidence: '2', rationale: '', confidence: 'medium' },
      ],
    })
    expect(back.labels.refB.confidence).toBeNull()
    expect(back.labels.refOld.confidence).toBe('medium')
  })

  it('folds a reference once its passages are judged and it has a level', () => {
    const open = judged({ status: 'accepted', cands: { c1: 'relevant' } })
    expect(referenceFinished(claim, open, 'refB')).toBe(false)
    const done = judged({
      status: 'accepted',
      cands: { c1: 'relevant', c2: 'rejected' },
      labels: { refB: { evidence: 3, rationale: '', confidence: 'medium' } },
    })
    expect(referenceFinished(claim, done, 'refB')).toBe(true)
    expect(referenceSummary(claim, done, refs[0], 'refB')).toBe('Silva, Lee · 2021: 1 of 2 relevant · level 3 Clear · medium confidence')
  })

  it('finishes a reference with no relevant passages and checks hand-added passages when there are no candidates', () => {
    const rejected = judged({ status: 'accepted', cands: { c1: 'rejected', c2: 'rejected' } })
    expect(referenceFinished(claim, rejected, 'refB')).toBe(true)

    const noCandidates = { ...claim, candidates: [] }
    const added = [{ reference_id: 'other', page: 1, passage: 'other reference' }]
    expect(referenceFinished(noCandidates, { ...emptyDraft(), added }, 'refB')).toBe(false)
  })

  it('summarizes a reference without a marker, level or known label', () => {
    expect(referenceSummary({ ...claim, candidates: [] }, emptyDraft(), { reference_id: 'refB', file: 'refB.pdf', label: 'Ref B' }, 'refB'))
      .toBe('Ref B: 0 of 0 relevant')
    expect(referenceSummary({ ...claim, candidates: [] }, emptyDraft(), undefined, 'unknown'))
      .toBe('unknown: 0 of 0 relevant')
  })

  it('wants the new wording of an edited claim', () => {
    expect(remaining(claim, judged({ status: 'edited', cands: { c1: 'rejected', c2: 'rejected' } }), refs)).toEqual([
      'Reword the claim, or choose Keep',
    ])
    const unchanged = judged({ status: 'edited', edited: claim.claim, cands: { c1: 'rejected', c2: 'rejected' } })
    expect(remaining(claim, unchanged, refs)).toEqual(['Reword the claim, or choose Keep'])
  })
})

describe('the next unfinished claim', () => {
  const bare = (id: string): WorkClaim => ({
    claim_id: id, claim: id, sentence: '', section: '', source: null, candidates: [], origin: 'extracted',
  })
  const six = ['1', '2', '3', '4', '5', '6'].map(bare)
  const rejected = (): Draft => ({ ...emptyDraft(), status: 'rejected' })
  const finished = Object.fromEntries(six.map((c) => [c.claim_id, rejected()]))

  it('goes to the next unfinished claim, wrapping past finished ones', () => {
    const drafts = { ...finished, '6': emptyDraft() }
    const saved = { ...finished, '6': emptyDraft() }
    // Claims 1-5 finished, 6 open. Saving claim 3 (index 2) opens claim 6.
    expect(nextUnfinishedIndex(six, drafts, saved, [], 2)).toBe(5)
    expect(saveNextTarget(six, drafts, saved, [], 2)).toEqual({ kind: 'claim', index: 5 })
  })

  it('says the paper is done when the last unfinished claim is saved', () => {
    const drafts = { ...finished }
    const saved = { ...finished, '6': emptyDraft() }
    expect(saveNextTarget(six, drafts, saved, [], 5)).toEqual({ kind: 'paper-done' })
  })

  it('moves to the next claim in order when every claim was already finished', () => {
    const saved = { ...finished }
    const drafts = { ...finished, '3': { ...rejected(), edited: 'a small fix' } }
    expect(saveNextTarget(six, drafts, saved, [], 2)).toEqual({ kind: 'claim', index: 3 })
  })

  it('stays when there is no current claim and uses an empty draft for missing progress', () => {
    expect(saveNextTarget([], {}, {}, [], 0)).toEqual({ kind: 'stay' })
    expect(isSavedDone(bare('missing'), {}, {}, [])).toBe(false)
    const incomplete = { ...claim, claim_id: 'incomplete', candidates: claim.candidates.slice(0, 1) }
    expect(saveNextTarget([incomplete], { incomplete: { ...emptyDraft(), status: 'accepted' } }, {}, [], 0))
      .toEqual({ kind: 'stay' })
  })

  it('picks the next paper in the same topic that is not finished', () => {
    const pool = gateway.pool as Parameters<typeof nextPaperInTopic>[0]
    expect(nextPaperInTopic(pool, 'a1')?.analysis_id).toBe('a2')
    expect(nextPaperInTopic({ ...pool, papers: pool.papers.map((p) => ({ ...p, topic: 'CV' })) }, 'a1')).toBeNull()
    expect(nextPaperInTopic({ ...pool, people: [] }, 'a1')).toBeNull()
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
    gateway.searched.length = 0
    gateway.found = []
    gateway.failSearch = false
    window.localStorage.removeItem('labeler.unsaved.a1.chanya')
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
    expect(viewers).toEqual(['paperA.pdf|We show Y improves recall.', 'refB.pdf|recall rose by 4 points'])

    expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const [relevant1, , , notRelevant2] = screen.getAllByRole('radio', { name: /Relevant|Not relevant/ })
    fireEvent.click(relevant1)
    fireEvent.click(notRelevant2)
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    expect(screen.getByRole('radio', { name: /^Low/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: /^Medium/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Give Silva, Lee · 2021 a confidence')).toHaveAttribute('title', 'Give Silva, Lee · 2021 a confidence')
    fireEvent.click(screen.getByRole('radio', { name: /^Medium/ }))
    expect(screen.getByText('Every decision made, not saved yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0]).toMatchObject({
      claims: [{ claim_id: 'paperA#0', status: 'accepted' }],
      candidates: [{ cand_id: 'c1', status: 'relevant' }, { cand_id: 'c2', status: 'rejected' }],
      labels: [{ reference_id: 'refB', evidence: 3, confidence: 'medium', spans: ['recall rose by 4 points'] }],
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
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

  it('keeps the claim in view after a decision, and shows an edited wording', async () => {
    await open()
    expect(screen.queryByRole('region', { name: 'Claim being judged' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const pin = screen.getByRole('region', { name: 'Claim being judged' })
    expect(pin).toHaveTextContent('Method Y improves recall.')
    expect(pin.querySelector('.line-clamp-4')).not.toBeNull()

    fireEvent.keyDown(window, { key: 'e' })
    fireEvent.change(screen.getByLabelText('The claim, as it should read'), { target: { value: 'Y raises recall.' } })
    expect(screen.getByRole('region', { name: 'Claim being judged' })).toHaveTextContent('Y raises recall.')
  })

  it('pins the claim above the save bar on a narrow screen', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.getByRole('region', { name: 'Claim being judged' }).parentElement).toHaveClass('sticky')
  })

  it('says what a shortcut just did, and Z undoes that one step', async () => {
    await open()
    fireEvent.keyDown(window, { key: 'k' })
    expect(screen.getByRole('status')).toHaveTextContent('Keep · Z to undo')
    fireEvent.keyDown(window, { key: 'r' })
    expect(screen.getByRole('status')).toHaveTextContent('Passage 1 relevant · Z to undo')
    expect(screen.getAllByTestId('viewer').at(-1)!).toHaveTextContent('unrelated text')
    fireEvent.keyDown(window, { key: 'z' })
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage 1 relevant')
    expect(screen.getAllByRole('radio', { name: /^Relevant/ })[0]).toHaveAttribute('aria-checked', 'false')
    expect(screen.getAllByTestId('viewer').at(-1)!).toHaveTextContent('recall rose by 4 points')
    fireEvent.keyDown(window, { key: 'z' })
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Keep')
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'z' })
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to undo')

    fireEvent.keyDown(window, { key: 'k' })
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(window, { key: '4' })
    expect(screen.getByRole('status')).toHaveTextContent('Silva, Lee · 2021 level 4 Strong · Z to undo')
    expect(screen.getByRole('radio', { name: /4 · Strong/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /4 · Strong/ })).toHaveAttribute('aria-keyshortcuts', '4')
  })

  it('lets Z take back a click, not only a key', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.getByRole('button', { name: /Keep/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'z' })
    expect(screen.getByRole('status')).toHaveTextContent('Undone')
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
  })

  it('does not make an undo step of typing the claim', async () => {
    await open()
    fireEvent.keyDown(window, { key: 'e' })
    fireEvent.change(screen.getByLabelText('The claim, as it should read'), { target: { value: 'Y raises recall.' } })
    fireEvent.change(screen.getByLabelText('The claim, as it should read'), { target: { value: 'Y raises recall a lot.' } })
    fireEvent.keyDown(window, { key: 'z' })
    // One Z goes back past the typing to before Edit, not one letter.
    expect(screen.getByRole('status')).toHaveTextContent('Undone')
    expect(screen.queryByLabelText('The claim, as it should read')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('says there is nothing to undo when nothing was done', async () => {
    await open()
    fireEvent.keyDown(window, { key: 'z' })
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to undo')
  })

  it('takes a passage verdict back when the chosen one is clicked again', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const relevant = () => screen.getAllByRole('radio', { name: /^Relevant/ })[0]
    fireEvent.click(relevant())
    expect(relevant()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(relevant())
    expect(relevant()).toHaveAttribute('aria-checked', 'false')
    fireEvent.keyDown(window, { key: 'z' })
    expect(relevant()).toHaveAttribute('aria-checked', 'true')
  })

  it('clears a decision that is not saved yet', async () => {
    await open()
    expect(screen.queryByRole('button', { name: 'Clear decision' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear decision' }))
    expect(screen.getByRole('status')).toHaveTextContent('Decision cleared')
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('button', { name: 'Clear decision' })).not.toBeInTheDocument()
  })

  it('clears a changed decision back to the one that was saved', async () => {
    const before = gateway.session
    gateway.session = {
      ...before,
      saved: {
        claims: [{ claim_id: 'paperA#0', origin: 'extracted', status: 'accepted', claim: 'Method Y improves recall.', claim_edited: '', sentence: '', section: '3', page: '' }],
        candidates: [],
        labels: [],
      },
    } as typeof before
    try {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Workspace analysisId="a1" />
        </QueryClientProvider>,
      )
      fireEvent.click(await screen.findByRole('button', { name: /Keep/ }))
      expect(screen.queryByRole('button', { name: /^Discard/ })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('radio', { name: /Reject/ }))
      expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes to this claim' }))
      expect(screen.getByRole('status')).toHaveTextContent('Changes discarded · Z to undo')
      expect(screen.getByRole('button', { name: /Keep/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Discard/ })).not.toBeInTheDocument()
    } finally {
      gateway.session = before
    }
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
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
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
    expect(screen.getByRole('button', { name: /Keep/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('radio', { name: /^Relevant/ })[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('does not type the shortcut letter into the edit box that E opens', async () => {
    await open()
    const typed = fireEvent.keyDown(window, { key: 'e' }) // false when the default was prevented
    expect(typed).toBe(false)
    expect(screen.getByRole('button', { name: /Edit/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('The claim, as it should read')).toHaveValue('Method Y improves recall.')
  })

  it('saves and opens the next unfinished claim, then says the paper is done', async () => {
    const onBack = vi.fn()
    const onOpenPaper = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Workspace analysisId="a1" onBack={onBack} onOpenPaper={onOpenPaper} />
      </QueryClientProvider>,
    )
    await screen.findByRole('radiogroup', { name: 'Decision on this claim' })
    fireEvent.click(screen.getByRole('button', { name: /^Claim 2, not started/ }))
    fireEvent.click(await screen.findByRole('radio', { name: /Reject/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    // Claim 2 is finished. Claim 1 is still open, so Save and next wraps back to it.
    expect(await screen.findByRole('heading', { name: /Claim 1 of 2/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    expect(await screen.findByRole('heading', { name: 'This paper is labeled' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next paper in your topic' }))
    expect(onOpenPaper).toHaveBeenCalledWith('a2')
    fireEvent.click(screen.getByRole('button', { name: 'Back to papers' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('jumps to the first unfinished claim from the Next unfinished button', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Next unfinished' }))
    expect(await screen.findByRole('heading', { name: /Claim 2 of 2/ })).toBeInTheDocument()
  })

  it('does not count a finished claim as finished until it is saved', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: /^Not relevant/ })[1])
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    fireEvent.keyDown(window, { key: 'h' })
    expect(screen.getByRole('radio', { name: /^High/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Every decision made, not saved yet')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 claims finished')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim 1, in progress, unsaved/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    expect(await screen.findByText('1 of 2 claims finished')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim 1, finished:/ })).toBeInTheDocument()
  })

  it('judges the focused passage with R and N, moves on to the next unjudged one, and decides the claim with K, E, X', async () => {
    await open()
    const shown = () => screen.getAllByTestId('viewer').at(-1)!.textContent
    fireEvent.keyDown(window, { key: 'k' })
    expect(screen.getByRole('button', { name: /Keep/ })).toHaveAttribute('aria-expanded', 'false')
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
    expect(screen.getByRole('button', { name: /Edit/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.getByRole('button', { name: /Reject/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('focuses the edit box when Edit is chosen, not when coming back to a claim being edited', async () => {
    await open()
    fireEvent.keyDown(window, { key: 'e' })
    expect(screen.getByLabelText('The claim, as it should read')).toHaveFocus()
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(window, { key: ']' })
    expect(await screen.findByRole('heading', { name: /Claim 2 of 2/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '[' })
    expect(await screen.findByRole('heading', { name: /Claim 1 of 2/ })).toBeInTheDocument()
    // Otherwise the next K or ] would be typed into the claim instead of acting as a shortcut.
    expect(screen.getByLabelText('The claim, as it should read')).not.toHaveFocus()
  })

  it('ignores the shortcut keys while typing in a field', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Edit/ }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'x' })
    expect(screen.getByRole('button', { name: /Edit/ })).toHaveAttribute('aria-expanded', 'false')
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
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })

  it('shows each reference as one section, with one level form after its passages', async () => {
    await open()
    expect(screen.getByText(/The paper says/)).toHaveTextContent('We show Y improves recall.')
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.queryByText(/The paper says/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Claim being judged' })).toHaveTextContent('Method Y improves recall.')
    const section = screen.getByRole('region', { name: 'Ref B' })
    expect(within(section).getAllByRole('radiogroup', { name: /^Passage/ })).toHaveLength(2)
    const focused = within(section).getByRole('button', { name: /recall rose by 4 points/ }).closest('li')
    const form = section.querySelector('[data-level-form]')!
    expect(form).toBeInTheDocument()
    const lastCard = within(section).getAllByRole('radiogroup', { name: /^Passage/ }).at(-1)!.closest('li')!
    expect(lastCard.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(focused?.nextElementSibling).not.toHaveAttribute('data-level-form')
    expect(form).toHaveTextContent('Mark a passage relevant to grade this reference')
    fireEvent.click(within(section).getAllByRole('radio', { name: /^Relevant/ })[0])
    expect(within(section).getByRole('radiogroup', { name: 'Support level for Silva, Lee · 2021' })).toBeInTheDocument()
    expect(section.querySelectorAll('[data-level-form]')).toHaveLength(1)
  })

  it('takes a passage and a level for a cited work with no PDF, without opening a reference for it', async () => {
    const session = gateway.session as typeof gateway.session & { unread?: unknown[] }
    session.unread = [{ reference_id: 'unread-b2', file: '', label: 'Ref C', ref: 'b2', authors: [], year: '2020' }]
    try {
      await open()
      fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
      fireEvent.change(screen.getByLabelText('Reference paper'), { target: { value: 'unread-b2' } })
      expect(screen.getByRole('option', { name: 'Ref C (no PDF)' })).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('The passage'), { target: { value: 'CoT is not explainability' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))

      const section = screen.getByRole('region', { name: 'Ref C' })
      expect(within(section).queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument()
      expect(api.findInPaper).not.toHaveBeenCalledWith('', expect.anything(), expect.anything())
      fireEvent.keyDown(window, { key: '3' })
      expect(within(section).getByRole('radio', { name: /3 · Clear/ })).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
      await waitFor(() => expect(gateway.posts).toHaveLength(1))
      expect(gateway.posts[0]).toMatchObject({
        candidates: expect.arrayContaining([
          expect.objectContaining({ reference_id: 'unread-b2', origin: 'human_added', passage: 'CoT is not explainability' }),
        ]),
        labels: [{ reference_id: 'unread-b2', evidence: 3 }],
      })
    } finally {
      delete session.unread
    }
  })

  it('shows the focused passage in full and clamps the others', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const first = screen.getByText('recall rose by 4 points')
    const second = screen.getByText('unrelated text')
    expect(first).not.toHaveClass('line-clamp-3')
    expect(first).toHaveClass('block')
    expect(second).toHaveClass('line-clamp-3')
    expect(second).not.toHaveClass('block')
    expect(screen.getByRole('button', { name: /recall rose by 4 points/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /unrelated text/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('looks for the whole focused passage in the reference, not only its first 300 characters', async () => {
    const candidate = gateway.session.claims[0].candidates[0]
    const short = candidate.passage
    candidate.passage = `${'recall rose by 4 points on every benchmark we tried. '.repeat(10)}The end.`
    try {
      await open()
      await waitFor(() => expect(api.findInPaper).toHaveBeenCalledWith('refB.pdf', candidate.passage, 5))
    } finally {
      candidate.passage = short
    }
  })

  it('starts with the reference alone when no choice is stored, at any width', async () => {
    window.localStorage.removeItem('labeler.paperView')
    await open()
    expect(shownViewers()).toEqual(['refB.pdf|recall rose by 4 points'])
  })

  it('shows the reference alone, and remembers the choice', async () => {
    await open()
    expect(shownViewers()).toHaveLength(2)
    const [paper, reference] = screen.getAllByTestId('viewer')
    fireEvent.click(screen.getByRole('button', { name: 'Reference only' }))
    expect(shownViewers()).toEqual(['refB.pdf|recall rose by 4 points'])
    expect(window.localStorage.getItem('labeler.paperView')).toBe('reference')
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }))
    expect(shownViewers()).toHaveLength(2)
    // The same viewers, only laid out again: neither PDF opens a second time.
    expect(screen.getAllByTestId('viewer')).toEqual([paper, reference])
    window.localStorage.removeItem('labeler.paperView')
  })

  it('names each paper: this paper, then the reference by its marker, title and authors', async () => {
    await open()
    expect(screen.getAllByTestId('viewer-heading').map((h) => h.textContent)).toEqual([
      'Paper A',
      'Reference: Ref B / Silva, Lee · 2021',
    ])
    expect(screen.getAllByTestId('viewer-role').map((r) => r.textContent)).toEqual(['under-review', 'reference'])
  })

  it('puts the paper under review left and the reference right, side by side', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }))
    expect(screen.getAllByTestId('viewer').map((v) => v.textContent)).toEqual([
      'paperA.pdf|We show Y improves recall.',
      'refB.pdf|recall rose by 4 points',
    ])
    expect(screen.getAllByTestId('viewer-role').map((r) => r.textContent)).toEqual(['under-review', 'reference'])
    expect(window.localStorage.getItem('labeler.paperView')).toBe('side')
  })

  it('offers side by side only from 1600px, and stacks a stored side-by-side choice below that', async () => {
    window.localStorage.setItem('labeler.paperView', 'side')
    window.matchMedia = vi.fn((query: string) => ({
      matches: query !== '(min-width: 1600px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    await open()
    expect(screen.queryByRole('button', { name: 'Side by side' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stacked' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('viewer-role').map((r) => r.textContent)).toEqual(['under-review', 'reference'])
  })

  it('asks the claim question in words, apart from the key caps', async () => {
    await open()
    const decision = screen.getByRole('radiogroup', { name: 'Decision on this claim' })
    expect(decision).toHaveAccessibleDescription('Is this a claim the paper makes?')
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveTextContent(/^KeepYes, and it is worded right\.K$/)
    expect(screen.getByRole('radio', { name: /Reject/ })).toHaveTextContent('No, it is not a claim of this paper.')
  })

  it('puts a level’s meaning on its button, and highlights the chosen level', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    const clear = screen.getByRole('radio', { name: '3 · Clear' })
    expect(clear).toHaveAccessibleDescription('The passage backs the claim, with a gap in scope or detail.')
    fireEvent.click(clear)
    expect(clear).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '4 · Strong' })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps an undecided claim when evidence is added to it', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.getByRole('button', { name: /Keep/ })).toHaveAttribute('aria-expanded', 'false')
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
    expect(screen.getByRole('button', { name: /Edit/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByDisplayValue('picked in paperA.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new claim' }))
    expect(screen.getByText(/· added/)).toBeInTheDocument()
  })

  it('boxes a claim added from the paper on its page, and saves its sentence and page', async () => {
    vi.mocked(api.findInPaper).mockImplementation(async (paper, q) =>
      paper === 'paperA.pdf' && q === 'picked in paperA.pdf'
        ? { page: 4, boxes: [{ x0: 10, y0: 20, x1: 300, y1: 32 }], page_width: 612, page_height: 792 }
        : { page: null, boxes: [] },
    )
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new claim' }))

    expect(await screen.findByText('paperA.pdf: boxed on page 4')).toBeInTheDocument()
    expect(api.findInPaper).toHaveBeenCalledWith('paperA.pdf', 'picked in paperA.pdf', 4)
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0]).toMatchObject({
      claims: [{ origin: 'human_added', claim: 'picked in paperA.pdf', sentence: 'picked in paperA.pdf', page: 4 }],
    })
  })

  it('adds a typed claim that is not in the paper without a box', async () => {
    vi.mocked(api.findInPaper).mockResolvedValue({ page: null, boxes: [] })
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Add a missed claim/ }))
    fireEvent.change(screen.getByLabelText('A claim extraction missed'), { target: { value: 'A claim nobody wrote' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add claim' }))

    await waitFor(() => expect(api.findInPaper).toHaveBeenCalledWith('paperA.pdf', 'A claim nobody wrote', undefined))
    expect(screen.getByText(/· added/)).toBeInTheDocument()
    expect(screen.getByText('paperA.pdf: no box')).toBeInTheDocument()
  })

  const addTypedClaim = (text: string) => {
    fireEvent.click(screen.getByRole('button', { name: /Add a missed claim/ }))
    fireEvent.change(screen.getByLabelText('A claim extraction missed'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Add claim' }))
  }
  const foundForAdded = {
    cand_id: 'h1',
    reference_id: 'refB',
    reference_file: 'refB.pdf',
    rank: 1,
    score: 7.5,
    page: 3,
    passage: 'Y doubles recall on Z',
  }

  it('searches the references for a claim added by hand, and saves the passages judged', async () => {
    gateway.found = [foundForAdded]
    await open()
    addTypedClaim('Y doubles recall')

    expect(await screen.findByText(/Y doubles recall on Z/)).toBeInTheDocument()
    expect(gateway.searched).toEqual([{ claim_id: expect.stringMatching(/^paperA#h-/), claim: 'Y doubles recall' }])
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0]).toMatchObject({
      candidates: [
        { cand_id: 'h1', origin: 'retrieved_added', status: 'relevant', rank: 1, score: 7.5, page: 3, passage: 'Y doubles recall on Z' },
      ],
    })
  })

  it('opens the best passage the search found for a claim added by hand', async () => {
    gateway.found = [{ ...foundForAdded, cand_id: 'h0', score: 2, page: 9, passage: 'a weak match' }, foundForAdded]
    await open()
    addTypedClaim('Y doubles recall')
    await waitFor(() => expect(screen.getAllByTestId('viewer').at(-1)!).toHaveTextContent('refB.pdf|Y doubles recall on Z'))
  })

  it('picks the reference the claim cites over a higher score elsewhere', () => {
    const cand = (reference_id: string, score: number) => ({
      cand_id: `${reference_id}-${score}`, reference_id, reference_file: `${reference_id}.pdf`, rank: 1, score, page: 1, passage: '',
    })
    const references = [
      { reference_id: 'refB', file: 'refB.pdf', label: 'B', ref: 'b4' },
      { reference_id: 'refC', file: 'refC.pdf', label: 'C', ref: 'b9' },
    ]
    const claim: WorkClaim = {
      claim_id: 'paperA#h-1', claim: 'Y wins', sentence: 'Y wins on Z [b4].', section: '', source: null, origin: 'human_added',
      candidates: [cand('refC', 9), cand('refB', 3), cand('refB', 5)],
    }
    expect(bestCandidate(claim, references)?.cand_id).toBe('refB-5')
    expect(bestCandidate({ ...claim, sentence: 'Y wins.' }, references)?.cand_id).toBe('refC-9')
    expect(bestCandidate({ ...claim, sentence: 'Y wins [b2; b4].' }, references)?.cand_id).toBe('refB-5')
    expect(bestCandidate({ ...claim, candidates: [] }, references)).toBeUndefined()
  })

  it('adds a claim on plain http, where the browser has no crypto.randomUUID', async () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function')
    })
    await open()
    addTypedClaim('A claim typed over http')

    await waitFor(() =>
      expect(gateway.searched).toEqual([{ claim_id: expect.stringMatching(/^paperA#h-[0-9a-f]{8}$/), claim: 'A claim typed over http' }]),
    )
    randomUUID.mockRestore()
  })

  it('says when the search for an added claim fails, and searches again on request', async () => {
    gateway.failSearch = true
    await open()
    addTypedClaim('Y doubles recall')

    expect(await screen.findByText(/Retrieval did not answer/)).toBeInTheDocument()
    gateway.failSearch = false
    gateway.found = [foundForAdded]
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }))
    expect(await screen.findByText(/Y doubles recall on Z/)).toBeInTheDocument()
    expect(screen.queryByText(/Retrieval did not answer/)).not.toBeInTheDocument()
  })
})

describe('opening a reference by hand', () => {
  const session = gateway.session
  beforeEach(() => {
    gateway.session = {
      ...session,
      references: [...session.references, { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C', ref: 'b9', authors: [], year: '2020' }],
      // b30 was cited but never read, so it has no paper to open.
      markers: [
        { ref: 'b9', text: 'Guo et al., 2025', page: 1, x0: 0, y0: 0, x1: 1, y1: 1, page_width: 10, page_height: 10 },
        { ref: 'b30', text: 'OpenAI et al., 2024', page: 1, x0: 0, y0: 0, x1: 1, y1: 1, page_width: 10, page_height: 10 },
      ],
    } as typeof session
    window.localStorage.removeItem('labeler.unsaved.a1.chanya')
    window.localStorage.setItem('labeler.paperView', 'both')
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => {
    gateway.session = session
  })

  const open = async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" />
      </QueryClientProvider>,
    )
    await screen.findByRole('radiogroup', { name: 'Decision on this claim' })
  }

  it('opens the reference a citation in the paper names, and only for references that were read', async () => {
    await open()
    expect(screen.queryByRole('button', { name: 'cite OpenAI et al., 2024' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'cite Guo et al., 2025' }))
    expect(screen.getAllByTestId('viewer').at(-1)!).toHaveTextContent('refC.pdf')
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getByRole('button', { name: 'select in refC.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.getAllByText('picked in refC.pdf', { exact: false }).length).toBeGreaterThan(0)
  })

  it('opens any reference from the list, cited by the claim or not', async () => {
    await open()
    fireEvent.change(screen.getByRole('combobox', { name: 'Open reference' }), { target: { value: 'refC' } })
    expect(screen.getAllByTestId('viewer').at(-1)!).toHaveTextContent('refC.pdf')
  })
})

describe('unsaved labels', () => {
  beforeEach(() => {
    gateway.posts.length = 0
    gateway.failSaves = false
    window.localStorage.removeItem('labeler.unsaved.a1.chanya')
    window.localStorage.setItem('labeler.paperView', 'both')
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  const open = async () => {
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <Workspace analysisId="a1" />
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: /Claim 1 of 2/ })
    return view
  }

  it('come back after the page is opened again, until they are saved', async () => {
    const first = await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    first.unmount()

    await open()
    expect(screen.getByRole('button', { name: /Keep/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/Unsaved labels from your last visit/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    fireEvent.click(screen.getAllByRole('radio', { name: /^Not relevant/ })[1])
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    await waitFor(() => expect(window.localStorage.getItem('labeler.unsaved.a1.chanya')).toBeNull())
  })
})

describe('claims added by hand earlier', () => {
  it('come back with the sentence and page they were saved with, so they can be boxed again', () => {
    const [added] = workClaims({
      ...gateway.session,
      saved: {
        claims: [{ claim_id: 'paperA#h-abc123', origin: 'human_added', claim: 'X beats Y', sentence: 'X beats Y on Z.', page: '6', section: '' }],
        candidates: [],
        labels: [],
      },
    }).filter((c) => c.origin === 'human_added')
    expect(added).toMatchObject({ claim: 'X beats Y', sentence: 'X beats Y on Z.', page: 6, source: null })
    expect(buildSave(added, judged({ status: 'accepted' })).claims[0]).toMatchObject({ sentence: 'X beats Y on Z.', page: 6 })
  })

  it('keep the passages the search found for them that were judged, with the judgment', () => {
    const saved = {
      claims: [{ claim_id: 'paperA#h-abc123', origin: 'human_added', claim: 'X beats Y', sentence: '', page: '', section: '' }],
      candidates: [
        { claim_id: 'paperA#h-abc123', reference_id: 'refB', cand_id: 'h1', origin: 'retrieved_added', status: 'rejected', rank: '2', score: '3.5', page: '8', passage: 'X ties Y' },
      ],
      labels: [],
    }
    const [added] = workClaims({ ...gateway.session, saved }).filter((c) => c.origin === 'human_added')
    expect(added.candidates).toEqual([
      { cand_id: 'h1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 2, score: 3.5, page: 8, passage: 'X ties Y' },
    ])
    expect(draftFromSaved(added, saved).cands).toEqual({ h1: 'rejected' })
    expect(draftFromSaved(added, saved).added).toEqual([])
  })
})

describe('byline', () => {
  const reference = (authors: string[], year: string) => ({ reference_id: 'r', file: 'r.pdf', label: 'R', ref: '', authors, year })

  it('names up to two authors by surname, then et al.', () => {
    expect(byline(reference(['Rodrigo Nogueira', 'Kyunghyun Cho'], '2019'))).toBe('Nogueira, Cho · 2019')
    expect(byline(reference(['Vladimir Karpukhin', 'Barlas Oguz', 'Sewon Min'], '2020'))).toBe('Karpukhin et al. · 2020')
  })

  it('leaves out what the citation list did not have', () => {
    expect(byline(reference([], '2019'))).toBe('2019')
    expect(byline(reference([], ''))).toBe('')
  })
})

describe('byline from an older gateway', () => {
  it('is empty when the reference has no authors or year', () => {
    expect(byline({ reference_id: 'r', file: 'r.pdf', label: '1901.04085' })).toBe('')
  })
})
