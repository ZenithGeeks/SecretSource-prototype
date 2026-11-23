/** The labeling page's pure rules and its data hooks (src/lib/labeling.ts). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  calls: [] as { path: string; init?: RequestInit }[],
  pool: {} as Record<string, unknown>,
  fail: false,
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    gateway.calls.push({ path, init })
    if (gateway.fail && init?.method === 'PUT') throw new Error('503: not set up')
    if (path === '/labeling/pool') return gateway.pool
    return {}
  }),
}))

import {
  bestCandidate,
  buildSave,
  byline,
  displayOrder,
  draftFromSaved,
  emptyDraft,
  emptyLabel,
  labelingApi,
  problem,
  progress,
  readUnsaved,
  remaining,
  sameDraft,
  useAssignTopic,
  useScopusSearch,
  uncheckedPlain,
  workClaims,
  writeUnsaved,
  type Candidate,
  type Draft,
  type Pool,
  type Session,
  type WorkClaim,
} from '../src/lib/labeling'

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  cand_id: id,
  reference_id: 'refB',
  reference_file: 'refB.pdf',
  rank: 1,
  score: 1,
  page: 1,
  passage: `passage ${id}`,
  ...over,
})
const claim = (over: Partial<WorkClaim> = {}): WorkClaim => ({
  claim_id: 'p#0',
  claim: 'Y is fast.',
  sentence: '',
  section: '',
  source: null,
  candidates: [],
  origin: 'extracted',
  ...over,
})
const session = (saved: Partial<Session['saved']> = {}, over: Partial<Session> = {}): Session => ({
  analysis_id: 'a1',
  paper_id: 'p',
  paper_file: 'p.pdf',
  title: 'P',
  annotator: 'chanya',
  claims: [],
  references: [{ reference_id: 'refB', file: 'refB.pdf', label: 'Ref B' }],
  saved: { claims: [], candidates: [], labels: [], ...saved },
  others: {},
  ...over,
})

describe('problem', () => {
  it.each([
    [new Error('401: nope'), 'Please sign in again'],
    [new Error('403: {"detail": "x"}'), "You can't use the labeler"],
    [new Error('404: gone'), 'This paper is not available'],
    [new Error('502: bad API key'), 'Scopus refused the API key'],
    [new Error('502: down'), 'Scopus did not answer'],
    [new Error('504: slow'), 'Scopus took too long to answer'],
    [new Error('429: quota'), 'The Scopus key has used its quota for now'],
    [new Error('409: running'), 'This paper is not ready'],
    [new Error('422: bad'), 'That was not accepted'],
    [new Error('503: setup'), 'Labels cannot be saved yet'],
    [new Error('500: boom'), 'Something went wrong'],
    ['not an Error', 'Something went wrong'],
  ])('titles %s', (error, title) => {
    expect(problem(error).title).toBe(title)
  })
})

describe('byline', () => {
  it('is empty without authors or a year', () => {
    expect(byline({ reference_id: 'r', file: '', label: '' })).toBe('')
  })

  it('lists one or two surnames and the year', () => {
    expect(byline({ reference_id: 'r', file: '', label: '', authors: ['Ana Silva', ' Bo  Lee '], year: '2019' })).toBe('Silva, Lee · 2019')
  })

  it('shortens three or more authors to the first and et al.', () => {
    expect(byline({ reference_id: 'r', file: '', label: '', authors: ['A One', 'B Two', 'C Three'] })).toBe('One et al.')
  })
})

describe('labelingApi', () => {
  beforeEach(() => {
    gateway.calls.length = 0
  })

  it('adds one rank parameter per rank a search is limited to', async () => {
    await labelingApi.scopusSearch({ topic: 'CV', scope: 'topic', q: 'x', since: 2000, until: 2020, sort: 'cited', rank: 'top' }, 1)
    const url = new URL(gateway.calls[0].path, 'http://x')
    expect(url.searchParams.getAll('rank')).toEqual(['Q1', 'A*'])
    expect(url.searchParams.get('page')).toBe('1')
  })
})

describe('workClaims', () => {
  it('keeps the claims added by hand, with the passages the live search found for them', () => {
    const s = session({
      claims: [
        { claim_id: 'p#0', origin: 'human_added', claim: 'known' },
        { claim_id: 'p#9', origin: 'extracted', claim: 'extracted' },
        { claim_id: 'p#h', origin: 'human_added', claim: 'mine', sentence: 'S.', section: '2', page: '4' },
        { claim_id: 'p#bare', origin: 'human_added', claim: 'bare' },
      ],
      candidates: [
        { claim_id: 'p#h', origin: 'retrieved_added', cand_id: 'x1', reference_id: 'refB', rank: '2', score: '3.5', page: '7', passage: 'found' },
        { claim_id: 'p#h', origin: 'retrieved_added', cand_id: 'x2', reference_id: 'gone', rank: '', score: '', page: 'n/a', passage: 'orphan' },
        { claim_id: 'p#h', origin: 'human_added', cand_id: '', reference_id: 'refB', passage: 'by hand' },
      ],
    })
    s.claims = [{ claim_id: 'p#0', claim: 'known', sentence: '', section: '', source: null, candidates: [] }]
    const all = workClaims(s)
    expect(all.map((c) => c.claim_id)).toEqual(['p#0', 'p#h', 'p#bare'])
    expect(all[1]).toMatchObject({ origin: 'human_added', sentence: 'S.', section: '2', page: 4 })
    expect(all[1].candidates).toEqual([
      { cand_id: 'x1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 2, score: 3.5, page: 7, passage: 'found' },
      { cand_id: 'x2', reference_id: 'gone', reference_file: '', rank: 0, score: null, page: null, passage: 'orphan' },
    ])
    expect(all[2]).toMatchObject({ sentence: '', section: '', page: null })
  })

  it('puts a saved live search back on an extracted claim, and does not add a passage it already has', () => {
    const stored = cand('c1', { passage: 'already stored' })
    const s = session(
      {
        claims: [{ claim_id: 'p#0', origin: 'extracted', claim: 'extracted' }],
        candidates: [
          { claim_id: 'p#0', origin: 'retrieved_added', cand_id: 'x1', reference_id: 'refB', rank: '1', score: '9', page: '3', passage: 'text-to-text' },
          { claim_id: 'p#0', origin: 'retrieved_added', cand_id: 'c1', reference_id: 'refB', rank: '2', score: '1', page: '1', passage: 'already stored' },
          { claim_id: 'p#0', origin: 'retrieved', cand_id: 'old', reference_id: 'refB', rank: '1', score: '1', page: '1', passage: 'from the analysis' },
          { claim_id: 'p#9', origin: 'retrieved_added', cand_id: 'other', reference_id: 'refB', rank: '1', score: '1', page: '1', passage: 'elsewhere' },
        ],
      },
      {
        claims: [{ claim_id: 'p#0', claim: 'extracted', sentence: '', section: '', source: null, candidates: [stored] }],
      },
    )
    const [extracted] = workClaims(s)
    expect(extracted.candidates).toEqual([
      stored,
      { cand_id: 'x1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 1, score: 9, page: 3, passage: 'text-to-text', fromSearch: true },
    ])
  })
})

describe('draftFromSaved', () => {
  it('restores the status, the edit, the judged passages, the added ones and the labels', () => {
    const saved = session({
      claims: [{ claim_id: 'p#0', status: 'edited', claim_edited: 'new' }],
      candidates: [
        { claim_id: 'p#0', origin: 'retrieved', cand_id: 'c1', status: 'relevant' },
        { claim_id: 'p#0', origin: 'retrieved_added', cand_id: 'c2', status: 'rejected' },
        { claim_id: 'p#0', origin: 'human_added', reference_id: 'refB', status: 'relevant', page: '3', passage: 'mine' },
        { claim_id: 'p#0', origin: 'human_added', reference_id: 'refB', status: 'rejected', passage: 'retracted' },
        { claim_id: 'other', origin: 'retrieved', cand_id: 'z', status: 'relevant' },
      ],
      labels: [
        { claim_id: 'p#0', reference_id: 'refB', evidence: '3', rationale: 'why', confidence: '' },
        { claim_id: 'p#0', reference_id: 'refC', evidence: '4', rationale: '', confidence: 'high' },
      ],
    }).saved
    expect(draftFromSaved(claim(), saved)).toEqual({
      status: 'edited',
      edited: 'new',
      cands: { c1: 'relevant', c2: 'rejected' },
      added: [{ reference_id: 'refB', page: 3, passage: 'mine' }],
      labels: {
        refB: { evidence: 3, rationale: 'why', confidence: null },
        refC: { evidence: 4, rationale: '', confidence: 'high' },
      },
    })
  })

  it('reads a saved claim row with no edit as an empty edit', () => {
    expect(draftFromSaved(claim(), session({ claims: [{ claim_id: 'p#0', status: 'accepted' }] }).saved).edited).toBe('')
  })
})

describe('displayOrder and bestCandidate', () => {
  const two = claim({
    sentence: 'We build on it [b4, b9].',
    candidates: [
      cand('a', { reference_id: 'r1', rank: 2, score: null }),
      cand('b', { reference_id: 'r2', rank: 1, score: 5 }),
      cand('c', { reference_id: 'r1', rank: 1, score: 2 }),
      cand('d', { reference_id: 'r3', rank: 1, score: null }),
    ],
  })

  it('groups passages by reference, best rank first', () => {
    expect(displayOrder(two).map((c) => c.cand_id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('prefers a passage from a reference the sentence cites', () => {
    const refs = [
      { reference_id: 'r1', file: '', label: 'R1', ref: 'b9' },
      { reference_id: 'r2', file: '', label: 'R2' },
    ]
    expect(bestCandidate(two, refs)?.cand_id).toBe('c')
  })

  it('falls back to the top score, and treats a missing score as zero', () => {
    expect(bestCandidate(two, [])?.cand_id).toBe('b')
    expect(bestCandidate(claim(), [])).toBeUndefined()
  })
})

describe('sameDraft and progress', () => {
  it('reads nothing saved as an empty draft', () => {
    expect(sameDraft(emptyDraft(), undefined)).toBe(true)
    expect(sameDraft({ ...emptyDraft(), status: 'accepted' }, undefined)).toBe(false)
  })

  it('counts a claim only when it is finished and saved', () => {
    const rejected: Draft = { ...emptyDraft(), status: 'rejected' }
    const claims = [claim({ claim_id: 'a' }), claim({ claim_id: 'b' }), claim({ claim_id: 'c' })]
    expect(progress(claims, { a: rejected, b: rejected }, [], { a: rejected })).toEqual({ done: 1, total: 3 })
  })
})

describe('unsaved drafts in the browser', () => {
  it('reads nothing back when storage cannot be read', () => {
    window.localStorage.setItem('labeler.unsaved.a1.chanya', '{broken')
    expect(readUnsaved('a1', 'chanya')).toBeNull()
  })

  it('keeps drafts, and forgets them when none is left', () => {
    const unsaved = { drafts: { 'p#0': emptyDraft() }, added: [] }
    writeUnsaved('a1', 'chanya', unsaved)
    expect(readUnsaved('a1', 'chanya')).toEqual(unsaved)
    writeUnsaved('a1', 'chanya', { drafts: {}, added: [] })
    expect(readUnsaved('a1', 'chanya')).toBeNull()
  })

  it('carries on when storage is blocked', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    expect(() => writeUnsaved('a1', 'chanya', { drafts: { x: emptyDraft() }, added: [] })).not.toThrow()
    setItem.mockRestore()
  })
})

describe('remaining', () => {
  it('asks for the edited wording, the unjudged passages and a level per reference', () => {
    const c = claim({ candidates: [cand('c1'), cand('c2')] })
    const draft: Draft = { ...emptyDraft(), status: 'edited', edited: 'Y is fast.', cands: { c1: 'relevant' } }
    expect(remaining(c, draft, [{ reference_id: 'refB', file: '', label: 'Ref B' }])).toEqual([
      'Write the edited claim',
      '1 passage not judged',
      'Give Ref B a level',
    ])
  })

  it('names a reference by its id when the list does not know it, and pluralises passages', () => {
    const c = claim({ candidates: [cand('c1', { reference_id: 'zz' }), cand('c2', { reference_id: 'zz' })] })
    expect(remaining(c, { ...emptyDraft(), status: 'accepted', cands: {} }, [])).toEqual(['2 passages not judged'])
    const judged: Draft = { ...emptyDraft(), status: 'accepted', cands: { c1: 'relevant', c2: 'rejected' } }
    expect(remaining(c, judged, [])).toEqual(['Give zz a level'])
  })

  it('requires confidence as well as a level on the reference', () => {
    const c = claim({ candidates: [cand('c1')] })
    const draft: Draft = {
      ...emptyDraft(),
      status: 'accepted',
      cands: { c1: 'relevant' },
      labels: { refB: { ...emptyLabel(), evidence: 3 } },
    }
    expect(remaining(c, draft, [])).toEqual(['Give refB a confidence'])
    expect(remaining(c, { ...draft, labels: { refB: { ...draft.labels.refB, confidence: 'medium' } } }, [])).toEqual([])
  })
})

describe('buildSave', () => {
  it('saves nothing for a claim not judged yet', () => {
    expect(buildSave(claim(), emptyDraft())).toEqual({ claims: [], candidates: [], labels: [] })
  })

  it('saves only the claim when it is rejected', () => {
    const save = buildSave(claim({ source: { page: 6 } as WorkClaim['source'] }), { ...emptyDraft(), status: 'rejected', edited: 'ignored' })
    expect(save.claims).toHaveLength(1)
    expect(save.claims[0]).toMatchObject({ claim_edited: '', page: 6 })
    expect(save.candidates).toEqual([])
  })

  it('sends only ids for an extracted claim and everything shown for one added by hand', () => {
    const draft: Draft = { ...emptyDraft(), status: 'edited', edited: ' better ', cands: { c1: 'relevant' } }
    const extracted = buildSave(claim({ candidates: [cand('c1'), cand('c2')] }), draft)
    expect(extracted.claims[0]).toMatchObject({ claim_edited: 'better', page: null })
    expect(extracted.candidates).toEqual([
      { claim_id: 'p#0', reference_id: 'refB', cand_id: 'c1', origin: 'retrieved', status: 'relevant', page: null, passage: '' },
    ])
    const byHand = buildSave(claim({ origin: 'human_added', page: 2, candidates: [cand('c1', { rank: 4, score: 7 })] }), draft)
    expect(byHand.claims[0].page).toBe(2)
    expect(byHand.candidates[0]).toMatchObject({ origin: 'retrieved_added', rank: 4, score: 7, page: 1, passage: 'passage c1' })
  })

  it('saves a live-search passage on an extracted claim as retrieved_added', () => {
    const draft: Draft = { ...emptyDraft(), status: 'accepted', cands: { c1: 'relevant', c2: 'relevant' } }
    const save = buildSave(
      claim({
        candidates: [cand('c1'), cand('c2', { fromSearch: true, rank: 1, score: 12, page: 3, passage: 'text-to-text' })],
      }),
      draft,
    )
    expect(save.candidates).toEqual([
      { claim_id: 'p#0', reference_id: 'refB', cand_id: 'c1', origin: 'retrieved', status: 'relevant', page: null, passage: '' },
      {
        claim_id: 'p#0',
        reference_id: 'refB',
        cand_id: 'c2',
        origin: 'retrieved_added',
        status: 'relevant',
        rank: 1,
        score: 12,
        page: 3,
        passage: 'text-to-text',
      },
    ])
  })

  it('retracts a passage that was saved and then removed, and keeps one still there', () => {
    const kept = { reference_id: 'refB', page: 1, passage: 'kept' }
    const gone = { reference_id: 'refB', page: 2, passage: 'gone' }
    const saved: Draft = { ...emptyDraft(), status: 'accepted', added: [kept, gone] }
    const draft: Draft = {
      ...emptyDraft(),
      status: 'accepted',
      added: [kept],
      labels: { refB: { evidence: 2, rationale: ' ok ', confidence: 'low' }, refC: emptyLabel() },
    }
    const save = buildSave(claim(), draft, saved)
    expect(save.candidates.map((c) => [c.passage, c.status])).toEqual([
      ['kept', 'relevant'],
      ['gone', 'rejected'],
    ])
    expect(save.labels).toEqual([
      { claim_id: 'p#0', reference_id: 'refB', evidence: 2, rationale: 'ok', spans: ['kept'], confidence: 'low' },
    ])
  })
})

describe('uncheckedPlain', () => {
  it('has a short line for each reason the analysis reports, and something for a code it does not know', () => {
    expect(uncheckedPlain('named')).toBe('not checked, the paper only names it')
    expect(uncheckedPlain('no-open-access')).toBe('no open-access PDF')
    expect(uncheckedPlain('not-downloadable')).toBe('the PDF could not be downloaded')
    expect(uncheckedPlain('unresolvable')).toBe('no matching work was found')
    expect(uncheckedPlain('lookup-unavailable')).toBe('the lookup service did not answer')
    expect(uncheckedPlain('web-source')).toBe('a web page, not a paper')
    expect(uncheckedPlain('withdrawn')).toBe('the paper was withdrawn')
    expect(uncheckedPlain('failed')).toBe('the check failed')
    expect(uncheckedPlain('mystery')).toBe('checking it failed')
  })
})

describe('data hooks', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const pool = (): Pool => ({
    topics: ['CV'],
    me: 'Chanya',
    people: [
      { name: 'Chanya', topic: '' },
      { name: 'Somchai', topic: 'CV' },
    ],
    papers: [
      { analysis_id: 'a', title: 'A', topic: 'CV' },
      { analysis_id: 'b', title: 'B', topic: 'CV' },
    ] as Pool['papers'],
  })

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    gateway.calls.length = 0
    gateway.fail = false
  })

  it('shows a person topic at once and puts it back when the save fails', async () => {
    client.setQueryData(['labeling', 'pool'], pool())
    gateway.fail = true
    const { result } = renderHook(() => useAssignTopic(), { wrapper })
    await act(() => result.current.mutateAsync({ name: 'Chanya', topic: 'NLP' }).catch(() => undefined))
    expect(gateway.calls[0].path).toBe('/labeling/people')
    expect(client.getQueryData<Pool>(['labeling', 'pool'])?.people[0].topic).toBe('')
  })

  it('moves a paper to a topic, and drops it from the list when the topic is empty', async () => {
    gateway.pool = pool()
    client.setQueryData(['labeling', 'pool'], pool())
    const { result } = renderHook(() => useAssignTopic(), { wrapper })
    await act(() => result.current.mutateAsync({ analysisId: 'a', topic: 'NLP' }))
    expect(gateway.calls[0].path).toBe('/labeling/papers/a/topic')
    await act(() => result.current.mutateAsync({ analysisId: 'b', topic: '' }))
    expect(gateway.calls.map((c) => c.path)).toContain('/labeling/papers/b/topic')
  })

  it('works before the pool has loaded', async () => {
    const { result } = renderHook(() => useAssignTopic(), { wrapper })
    gateway.fail = true
    await act(() => result.current.mutateAsync({ analysisId: 'a', topic: 'NLP' }).catch(() => undefined))
    expect(client.getQueryData(['labeling', 'pool'])).toBeUndefined()
  })

  it('asks Scopus for the next page only while results remain, counting hidden ones', async () => {
    const pages = [
      { total: 3, results: [{ doi: '1' }], hidden: 1 },
      { total: 3, results: [{ doi: '2' }] }, // an older gateway sends no `hidden`
    ]
    const request = (await import('../src/lib/api')).request as ReturnType<typeof vi.fn>
    request.mockImplementation(async () => pages.shift())
    const query = { topic: 'CV', scope: 'topic', q: '', since: 2000, until: 2020, sort: 'cited', rank: 'any' } as const
    const { result } = renderHook(() => useScopusSearch(query), { wrapper })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
  })
})
