/** The labeling workspace beyond labeling.test.tsx: keyboard, saving on, narrow screens, selections,
 * claims added by hand, work kept from an earlier visit, and blind checks. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  session: {} as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  sessionError: '',
  sessionReads: 0,
  rejectSourceReview: false,
  posts: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  saveFails: false,
  saveHangs: false,
  referenceErrorFor: '',
  searches: [] as unknown[],
  found: [] as unknown[],
  searchFails: false,
  locate: 'page' as 'page' | 'none' | 'fail',
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/candidates')) {
      gateway.searches.push(JSON.parse(String(init?.body)))
      if (gateway.searchFails) throw new Error('502: retrieval did not answer')
      return { candidates: gateway.found }
    }
    if (path.endsWith('/source-review') && init?.method === 'POST') {
      if (gateway.rejectSourceReview) {
        gateway.session.claims[0].evidence_revision = 1
        throw new Error('409: evidence changed; reload the latest session')
      }
      gateway.posts.push(JSON.parse(String(init.body)))
      return { reviewed: true }
    }
    if (path.includes('/references/') && (path.endsWith('/pdf') || path.endsWith('/retry') || path.endsWith('/repair'))) {
      if (gateway.referenceErrorFor === path) throw new Error('503: reference service unavailable')
      return { id: 'reference-check' }
    }
    if (init?.method === 'POST') {
      if (gateway.saveHangs) await new Promise(() => undefined)
      if (gateway.saveFails) throw new Error('503: not set up')
      gateway.posts.push(JSON.parse(String(init.body)))
      return { claims: 1, candidates: 2, labels: 1 }
    }
    if (path.startsWith('/labeling/sessions/')) {
      gateway.sessionReads += 1
      if (gateway.sessionError) throw new Error(gateway.sessionError)
      return gateway.session
    }
    throw new Error(`unexpected ${path}`)
  }),
  postEvents: vi.fn(),
  fetchFile: vi.fn(),
  api: {
    findInPaper: vi.fn(async () => {
      if (gateway.locate === 'fail') throw new Error('500: no')
      return gateway.locate === 'page' ? { page: 3, boxes: [] } : { page: null, boxes: [] }
    }),
  },
}))
vi.mock('../src/components/PageViewer', () => ({
  PageViewer: ({
    target,
    onSelectText,
    onClose,
    markers = [],
    onCitation,
  }: {
    target: { paper: string; quote?: string; label: string; detail?: string; source?: { page: number } | null; error?: string; page?: number }
    onSelectText?: (s: { text: string; page: number | null }) => void
    onClose?: () => void
    markers?: { ref: string; text: string }[]
    onCitation?: (marker: { ref: string; text: string }) => void
  }) => (
    <div>
      <div data-testid="viewer">
        {target.paper}|{target.quote}
      </div>
      <p data-testid="viewer-heading">
        {target.paper}: {target.label}
        {target.detail && ` / ${target.detail}`}
        {target.error && ` / error: ${target.error}`}
        {target.source ? ` / boxed on page ${target.source.page}` : ''} / opens on page {target.page}
      </p>
      <button type="button" onClick={() => onSelectText?.({ text: `picked in ${target.paper}`, page: 4 })}>
        select in {target.paper}
      </button>
      {onClose && (
        <button type="button" onClick={onClose}>
          close {target.paper}
        </button>
      )}
      {markers.map((m) => (
        <button key={m.text} type="button" onClick={() => onCitation?.(m)}>
          cite {m.text}
        </button>
      ))}
    </div>
  ),
}))

import { Workspace } from '../src/roles/labeler/screens/Workspace'
import { WebEvidenceViewer } from '../src/roles/labeler/components/WebEvidenceViewer'

const marker = (ref: string, text: string) => ({ ref, text, page: 1, x0: 0, y0: 0, x1: 1, y1: 1, page_width: 600 })

const makeSession = (over: Record<string, unknown> = {}) => ({
  analysis_id: 'a1',
  paper_id: 'paperA',
  paper_file: 'paperA.pdf',
  title: 'Paper A',
  annotator: 'chanya',
  claims: [
    {
      claim_id: 'paperA#0',
      claim: 'Method Y improves recall.',
      sentence: 'We show Y improves recall [4].',
      section: '3',
      source: null,
      candidates: [
        { cand_id: 'c1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 1, score: 9.1, page: 5, passage: 'recall rose by 4 points' },
        { cand_id: 'c2', reference_id: 'refB', reference_file: 'refB.pdf', rank: 2, score: 3, page: 2, passage: 'unrelated text' },
        { cand_id: 'c3', reference_id: 'refC', reference_file: 'refC.pdf', rank: 1, score: 2, page: null, passage: 'a different study' },
      ],
    },
    { claim_id: 'paperA#1', claim: 'Y is fast.', sentence: '', section: '', source: null, candidates: [] },
    {
      claim_id: 'paperA#2',
      claim: 'Z is cheap.',
      sentence: '',
      section: '',
      source: null,
      candidates: [{ cand_id: 'o1', reference_id: 'refB', reference_file: 'orphan.pdf', rank: 1, score: 1, page: 1, passage: 'from a file nobody listed' }],
    },
  ],
  references: [
    { reference_id: 'refB', file: 'refB.pdf', label: 'Ref B', ref: 'b4', authors: ['Ana Silva', 'Bo Lee'], year: '2021' },
    { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C' },
    { reference_id: 'refD', file: 'refD.pdf', label: 'Ref D', ref: 'b8' }, // cited by a marker, but no authors or year
  ],
  unread: [{ reference_id: 'refU', file: '', label: 'Ref U' }],
  markers: [marker('b4', '[4]'), marker('b9', '[9]')],
  saved: { claims: [], candidates: [], labels: [] },
  others: {},
  ...over,
})

const SAVED_HAND_ADDED = {
  claims: [{ claim_id: 'paperA#h-1', origin: 'human_added', status: 'accepted', claim: 'A claim I added.', claim_edited: '', sentence: 'The sentence.', section: '', page: '2' }],
  candidates: [],
  labels: [],
}

function renderWorkspace(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Workspace analysisId="a1" {...props} />
    </QueryClientProvider>,
  )
}

async function open(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  const view = renderWorkspace(props)
  await screen.findByRole('heading', { name: /^Claim 1 of/ })
  return view
}

const key = (k: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...extra })
const heading = () => screen.getByRole('heading', { name: /^Claim \d+ of/ }).textContent
/** What the reference viewer shows: stacked, it is the first of the two. */
const reference = () => screen.getAllByTestId('viewer')[0].textContent
const wideScreen = (matches: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

beforeEach(() => {
  gateway.session = makeSession()
  gateway.sessionError = ''
  gateway.sessionReads = 0
  gateway.rejectSourceReview = false
  gateway.posts.length = 0
  gateway.saveFails = false
  gateway.saveHangs = false
  gateway.referenceErrorFor = ''
  gateway.searches.length = 0
  gateway.found = []
  gateway.searchFails = false
  gateway.locate = 'page'
  window.localStorage.clear()
  window.localStorage.setItem('labeler.paperView', 'both')
  wideScreen(true)
})

it.each([true, false])('shows citation repair failures (wide: %s)', async (wide) => {
  wideScreen(wide)
  const claim = { ...makeSession().claims[0], citation_repairs: { b9: { message: 'wrong paper' } } }
  gateway.session = makeSession({ claims: [claim] })
  await open()
  expect(screen.getByRole('alert')).toHaveTextContent('Replacement for [b9] was not used: wrong paper. Previous evidence remains available.')
})

it('shows success and failure notices for cited-reference uploads and retries', async () => {
  const claim = {
    ...makeSession().claims[0],
    cited: ['b9'],
    unchecked: [{
      ref: 'b9', label: 'Unread work', doi: '10.1234/old', reason: 'no-open-access',
      source_outcome: { source_kind: 'unknown', outcome: 'temporary-failure', retryable: true, attempts: [] },
    }],
  }
  gateway.session = makeSession({ claims: [claim], unread: [] })
  await open()

  fireEvent.click(screen.getByRole('button', { name: 'Retry this reference' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Retry started for this reference.')
  gateway.referenceErrorFor = '/analyses/a1/references/b9/retry'
  fireEvent.click(screen.getByRole('button', { name: 'Retry this reference' }))
  expect(await screen.findByText('Labels cannot be saved yet')).toBeInTheDocument()

  const input = screen.getByLabelText('Provide a PDF for Unread work')
  const file = new File(['%PDF-1.4'], 'replacement.pdf', { type: 'application/pdf' })
  gateway.referenceErrorFor = ''
  fireEvent.change(input, { target: { files: [file] } })
  expect(await screen.findByRole('status')).toHaveTextContent('PDF received. Checking this reference now.')
  gateway.referenceErrorFor = '/analyses/a1/references/b9/pdf'
  fireEvent.change(input, { target: { files: [file] } })
  expect(await screen.findByText('Labels cannot be saved yet')).toBeInTheDocument()
})

it('shows success and failure notices when correcting a citation in the workspace', async () => {
  const claim = {
    ...makeSession().claims[0], cited: ['b9'],
    unchecked: [{ ref: 'b9', label: 'Unread work', doi: '10.1234/old', reason: 'no-open-access' }],
  }
  gateway.session = makeSession({ claims: [claim], unread: [] })
  await open()

  const doi = screen.getByLabelText('Correct DOI for Unread work')
  fireEvent.change(doi, { target: { value: '10.5678/new' } })
  fireEvent.click(screen.getByRole('button', { name: 'Try replacement' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Checking the corrected citation. Previous evidence stays available until it succeeds.')

  gateway.referenceErrorFor = '/analyses/a1/references/b9/repair'
  fireEvent.change(doi, { target: { value: '10.5678/other' } })
  fireEvent.click(screen.getByRole('button', { name: 'Try replacement' }))
  expect(await screen.findByText('Labels cannot be saved yet')).toBeInTheDocument()
})

it('asks the labeler to review saved labels after a cited source changes', async () => {
  const claim = { ...makeSession().claims[0], needs_review: true }
  gateway.session = makeSession({ claims: [claim] })
  await open()

  expect(screen.getByRole('status')).toHaveTextContent(
    'A source for this claim changed. Review its evidence before reusing the saved label.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Mark evidence reviewed' }))
  await waitFor(() => expect(gateway.posts).toContainEqual({ claim_id: 'paperA#0', evidence_revision: 0 }))
})

it('reloads the session and keeps review required when the evidence revision became stale', async () => {
  const claim = { ...makeSession().claims[0], needs_review: true, evidence_revision: 0 }
  gateway.session = makeSession({ claims: [claim] })
  gateway.sessionReads = 0
  gateway.rejectSourceReview = true
  await open()

  fireEvent.click(screen.getByRole('button', { name: 'Mark evidence reviewed' }))
  await waitFor(() => expect(gateway.sessionReads).toBeGreaterThanOrEqual(2))
  expect(screen.getByText(/Reloaded the latest session/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Mark evidence reviewed' })).toBeInTheDocument()
})

it('opens readable web citations as linkable web evidence instead of a PDF page', async () => {
  const url = 'https://example.org/article'
  const page = makeSession()
  page.claims[0] = {
    ...page.claims[0],
    cited: ['b5'],
    candidates: [{
      cand_id: 'web-candidate', reference_id: 'web-b5', reference_file: 'web-b5', rank: 1,
      score: 1, page: null, paragraph: 2, passage: 'Static text from the cited page.', locator: `${url}#finding`,
    }],
  }
  page.references = [{
    reference_id: 'web-b5', file: 'web-b5', label: 'Useful page', ref: 'b5',
    source_kind: 'web-page', url, retrieved_at: '2026-11-23T00:00:00+00:00',
  }]
  page.unread = []
  gateway.session = page
  await open()

  expect(screen.getByRole('region', { name: 'Web source evidence' })).toHaveTextContent('Static text from the cited page.')
  expect(screen.getByText(/Paragraph 2/)).toBeInTheDocument()
  expect(screen.getByText('Retrieved 2026-11-23T00:00:00+00:00')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Open cited page and passage/ })).toHaveAttribute('href', `${url}#finding`)
})

it('does not render a web evidence link for a malformed locator', async () => {
  const page = makeSession()
  page.claims[0] = {
    ...page.claims[0],
    cited: ['b5'],
    candidates: [{
      cand_id: 'web-candidate', reference_id: 'web-b5', reference_file: 'web-b5', rank: 1,
      score: 1, page: null, paragraph: 2, passage: 'Static text from the cited page.', locator: 'http://[',
    }],
  }
  page.references = [{
    reference_id: 'web-b5', file: 'web-b5', label: 'Useful page', ref: 'b5',
    source_kind: 'web-page', url: 'https://example.org/article', retrieved_at: '2026-11-23T00:00:00+00:00',
  }]
  page.unread = []
  gateway.session = page
  await open()

  expect(screen.queryByRole('link', { name: /Open cited page and passage/ })).not.toBeInTheDocument()
})

it('uses the page URL and default text when web evidence has no location details', () => {
  render(<WebEvidenceViewer title="" url="https://example.org/article" />)
  expect(screen.getByRole('heading', { name: 'Cited web page' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Open cited page and passage/ })).toHaveAttribute('href', 'https://example.org/article')
  expect(screen.getByText('Choose a retrieved paragraph to inspect its source location.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Close reference' })).not.toBeInTheDocument()
})

it('does not let an unsafe locator override the cited page URL', async () => {
  const page = makeSession()
  page.claims[0] = {
    ...page.claims[0],
    cited: ['b5'],
    candidates: [{
      cand_id: 'web-candidate', reference_id: 'web-b5', reference_file: 'web-b5', rank: 1,
      score: 1, page: null, paragraph: 2, passage: 'Static text from the cited page.', locator: 'javascript:alert(1)',
    }],
  }
  page.references = [{
    reference_id: 'web-b5', file: 'web-b5', label: 'Useful page', ref: 'b5',
    source_kind: 'web-page', url: 'javascript:alert(2)',
  }]
  page.unread = []
  gateway.session = page
  await open()

  expect(screen.queryByRole('link', { name: /Open cited page and passage/ })).not.toBeInTheDocument()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('polls a reference recheck until it finishes, then stops', async () => {
  gateway.session = makeSession({ stages: [{ stage: 'rechecking' }] })
  gateway.sessionReads = 0
  vi.useFakeTimers()
  renderWorkspace()
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(gateway.sessionReads).toBe(1)

  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(gateway.sessionReads).toBe(2)
  gateway.session = { ...gateway.session, stages: [{ stage: 'rechecked' }] }
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(gateway.sessionReads).toBe(3)
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
  expect(gateway.sessionReads).toBe(3)
})

describe('when the paper cannot be shown', () => {
  it('says why the claims cannot be opened', async () => {
    gateway.sessionError = '404: gone'
    renderWorkspace()
    expect(await screen.findByText('This paper is not available')).toBeInTheDocument()
  })

  it('says there are no claims, and ignores the keys', async () => {
    gateway.session = makeSession({ claims: [] })
    renderWorkspace()
    expect(await screen.findByText('No claims in this paper')).toBeInTheDocument()
    key('k')
    key('s', { ctrlKey: true })
    expect(gateway.posts).toEqual([])
  })

  it('retries opening the session after an error', async () => {
    gateway.sessionError = '503: not set up'
    renderWorkspace()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    gateway.sessionError = ''
    fireEvent.click(retry)
    expect(await screen.findByRole('heading', { name: 'Claim 1 of 3' })).toBeInTheDocument()
  })
})

describe('the keyboard', () => {
  it('keeps, edits and rejects the claim, and takes no key typed into a text box', async () => {
    await open()
    key('k')
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
    key('e')
    const box = await screen.findByRole('textbox', { name: 'The claim, as it should read' })
    expect(box).toHaveValue('Method Y improves recall.')
    fireEvent.keyDown(box, { key: 'x' })
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'true')
    key('x')
    expect(screen.getByRole('radio', { name: /Reject/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('ignores a letter pressed with Alt', async () => {
    await open()
    key('k', { altKey: true })
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('judges the focused passage and moves on to the next one not judged yet', async () => {
    await open()
    key('r') // nothing decided yet: passages are not judged
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'false')
    key('k')
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
    key('r')
    expect(reference()).toBe('refB.pdf|unrelated text')
    key('n')
    expect(reference()).toBe('refC.pdf|a different study')
    const [first, second] = screen.getAllByRole('radiogroup', { name: /^Passage \d of Ref B$/ })
    expect(within(first).getByRole('radio', { name: /^Relevant/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(second).getByRole('radio', { name: /^Not relevant/ })).toHaveAttribute('aria-checked', 'true')
    key('r')
    expect(reference()).toBe('refC.pdf|a different study') // everything is judged: it stays
  })

  it('walks the passages with J and U or the arrows, and stops at the ends', async () => {
    await open()
    key('k')
    key('j')
    expect(reference()).toBe('refB.pdf|unrelated text')
    key('ArrowDown')
    key('j')
    expect(reference()).toBe('refC.pdf|a different study')
    key('u')
    key('ArrowUp')
    key('u')
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
  })

  it('starts from the first or last passage when none is in focus', async () => {
    await open()
    key('k')
    const picker = screen.getByLabelText('Open reference')
    fireEvent.change(picker, { target: { value: 'refC' } })
    expect(reference()).toBe('refC.pdf|')
    key('j')
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
    fireEvent.change(picker, { target: { value: 'refC' } })
    key('u')
    expect(reference()).toBe('refC.pdf|a different study')
  })

  it('does not walk the passages of a rejected claim', async () => {
    await open()
    key('x')
    key('j')
    key('u')
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
  })

  it('moves between claims with the brackets and Shift with the arrows, and stays at the ends', async () => {
    await open()
    key('[')
    expect(heading()).toBe('Claim 1 of 3')
    key(']')
    expect(heading()).toBe('Claim 2 of 3')
    key('ArrowRight', { shiftKey: true })
    expect(heading()).toBe('Claim 3 of 3')
    key(']')
    expect(heading()).toBe('Claim 3 of 3')
    key('ArrowLeft', { shiftKey: true })
    key('[')
    expect(heading()).toBe('Claim 1 of 3')
    key('ArrowRight')
    expect(heading()).toBe('Claim 1 of 3')
  })

  it('gives the reference in view a level with 1 to 4, once it has a relevant passage', async () => {
    await open()
    key('k')
    key('2') // no relevant passage yet
    expect(screen.queryByRole('radio', { name: '2 · Weak' })).not.toBeInTheDocument()
    key('r')
    key('3')
    expect(screen.getByRole('radio', { name: '3 · Clear' })).toHaveAttribute('aria-checked', 'true')
    key('4')
    expect(screen.getByRole('radio', { name: '4 · Strong' })).toHaveAttribute('aria-checked', 'true')
  })

  it('does not give a level to a reference with no relevant passage', async () => {
    await open()
    key('k')
    key('r') // focus moves on to the second passage of Ref B
    key('j') // and then to Ref C's
    key('3')
    expect(screen.getByRole('radio', { name: '3 · Clear' })).toHaveAttribute('aria-checked', 'false')
  })

  it('sets the reference confidence with the L, M and H shortcuts', async () => {
    await open()
    key('k')
    key('r')
    key('l')
    expect(screen.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true')
    key('m')
    expect(screen.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true')
    key('h')
    expect(screen.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves with Ctrl+S only when something changed', async () => {
    await open()
    key('s', { ctrlKey: true })
    expect(gateway.posts).toEqual([])
    key('x')
    key('s', { metaKey: true })
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    await screen.findByText('Saved 4 rows')
    key('s', { ctrlKey: true })
    expect(gateway.posts).toHaveLength(1)
  })

  it('shows and hides the shortcut list with a question mark', async () => {
    await open()
    expect(screen.getByRole('list', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    key('?')
    expect(screen.queryByRole('list', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
  })

  it('shows the shortcuts when the browser will not say, and carries on when it will not remember', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    await open()
    expect(screen.getByRole('list', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    key('?')
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }))
    expect(screen.queryByRole('list', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
  })
})

describe('saving', () => {
  it('can reopen the claim list after finishing the paper', async () => {
    wideScreen(false)
    const onlyClaim = makeSession().claims[1]
    gateway.session = makeSession({ claims: [onlyClaim] })
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'Save and next claim' }))
    expect(await screen.findByText('This paper is labeled')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review claims' }))
    expect(screen.getByRole('heading', { name: 'Claim 1 of 1' })).toBeInTheDocument()
  })

  it('saves to the next unfinished claim and wraps to the first unfinished claim', async () => {
    await open()
    key(']')
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'Save and next claim' }))
    await waitFor(() => expect(heading()).toBe('Claim 3 of 3'))
    expect(gateway.posts).toHaveLength(1)
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'Save and next claim' }))
    await waitFor(() => expect(heading()).toBe('Claim 1 of 3'))
    expect(gateway.posts).toHaveLength(2)
  })

  it('stays on the claim after Save labels', async () => {
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await screen.findByText('Saved 4 rows')
    expect(heading()).toBe('Claim 1 of 3')
  })

  it('says why a save failed and keeps the draft', async () => {
    gateway.saveFails = true
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: Labels cannot be saved yet.')
    expect(screen.getByText('Unsaved changes · Ctrl/⌘+S saves')).toBeInTheDocument()
  })

  it('does not move to another claim while a save is running', async () => {
    gateway.saveHangs = true
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save labels/ })).toBeDisabled())
    key(']')
    expect(heading()).toBe('Claim 1 of 3')
  })

  it('stays put when the claim chosen is the one open', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 1,/ }))
    expect(heading()).toBe('Claim 1 of 3')
  })

  it('warns before the page closes with unsaved labels', async () => {
    await open()
    key('x')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('tells the app when labels are unsaved, and when leaving clears them', async () => {
    const onDirtyChange = vi.fn()
    const { unmount } = await open({ onDirtyChange })
    key('x')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    unmount()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})

describe('what the reference viewer is told', () => {
  it('names a reference by its marker and authors, and boxes the passage where it was found', async () => {
    await open()
    await waitFor(() => expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('boxed on page 3'))
    expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('refB.pdf: Reference [b4]: Ref B / Silva, Lee · 2021')
    expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('opens on page 5')
  })

  it('names a reference with no marker plainly, and opens on page 1 for a passage with no page', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getAllByRole('button', { name: /a different study/ })[0])
    expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('refC.pdf: Reference: Ref C')
    expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('opens on page 1')
  })

  it('shows the passage unboxed when it was not found, and says so when the look-up failed', async () => {
    gateway.locate = 'none'
    const { unmount } = await open()
    await waitFor(() => expect(screen.getAllByTestId('viewer-heading')[0]).not.toHaveTextContent('boxed'))
    unmount()

    gateway.locate = 'fail'
    await open()
    await waitFor(() => expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('error: Could not look up where this passage is.'))
  })

  it('opens the reference a citation in the paper points at, and ignores a citation to one not read', async () => {
    await open()
    expect(screen.queryByRole('button', { name: 'cite [9]' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'cite [4]' }))
    expect(reference()).toBe('refB.pdf|')
  })

  it('lets the person open any reference that was read', async () => {
    await open()
    const picker = screen.getByLabelText('Open reference')
    expect(within(picker).getByRole('option', { name: '[b4] Ref B' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Ref C' })).toBeInTheDocument()
    fireEvent.change(picker, { target: { value: 'refC' } })
    expect(reference()).toBe('refC.pdf|')
  })

  it('names a passage from a file the analysis did not list, and takes no evidence from it', async () => {
    await open()
    key(']')
    key(']')
    key('k')
    const heading0 = screen.getAllByTestId('viewer-heading')[0]
    expect(heading0).toHaveTextContent('orphan.pdf: Reference /')
    const picker = screen.getByLabelText('Open reference')
    expect(within(picker).getByRole('option', { name: 'Choose a reference' })).toBeInTheDocument()
    fireEvent.change(picker, { target: { value: 'nothing' } }) // not an option: nothing opens
    expect(reference()).toBe('orphan.pdf|from a file nobody listed')

    fireEvent.click(screen.getByRole('button', { name: 'select in orphan.pdf' }))
    expect(screen.getByText("That paper is not one of this analysis's references.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add as evidence' })).toBeDisabled()
  })
})

describe('text selected in a PDF', () => {
  it('adds the selection as evidence, keeps an undecided claim, and does not add it twice', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Passages you added')).toBeInTheDocument()
    expect(reference()).toBe('refB.pdf|picked in refB.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.getAllByRole('button', { name: 'Remove this passage' })).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Selected text' })).not.toBeInTheDocument()
  })

  it('keeps the decision already made when evidence is added', async () => {
    await open()
    key('e')
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(screen.getByRole('radio', { name: /Edit/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('will not add evidence to a rejected claim', async () => {
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'select in refB.pdf' }))
    expect(screen.getByText('This claim is rejected. Keep or edit it to add evidence.')).toBeInTheDocument()
  })

  it('uses a selection in the paper as the claim wording, or as a new claim, or drops it', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: "Use as this claim's wording" }))
    expect(screen.getByRole('textbox', { name: 'The claim, as it should read' })).toHaveValue('picked in paperA.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection' }))
    expect(screen.queryByRole('region', { name: 'Selected text' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'select in paperA.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new claim' }))
    await waitFor(() => expect(heading()).toBe('Claim 4 of 4 · added'))
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('passages and levels in the panel', () => {
  it('adds a passage by hand, removes it again, and grades the reference', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    fireEvent.change(screen.getByLabelText('Reference paper'), { target: { value: 'refB' } })
    fireEvent.change(screen.getByLabelText('The passage'), { target: { value: 'by hand' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    expect(reference()).toBe('refB.pdf|by hand')
    expect(screen.getAllByText('How well does Ref B support the claim?').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove this passage' }))
    expect(screen.queryByText('Passages you added')).not.toBeInTheDocument()
  })

  it('takes a passage for a cited work with no PDF, which opens in no viewer', async () => {
    await open()
    key(']')
    key('k')
    expect(screen.getByText('Nothing to label yet: judge a passage or add one.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    fireEvent.change(screen.getByLabelText('Reference paper'), { target: { value: 'refU' } })
    fireEvent.change(screen.getByLabelText('The passage'), { target: { value: 'cited only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    expect(screen.getByText('No reference paper')).toBeInTheDocument()
    expect(screen.getByText('How well does Ref U support the claim?')).toBeInTheDocument()
  })

  it('shows who else labeled the pair', async () => {
    gateway.session = makeSession({ others: { 'paperA#0|refB': ['Somchai'] } })
    await open()
    key('k')
    key('r')
    expect(screen.getByText('Also labeled by Somchai. Label it yourself, without looking.')).toBeInTheDocument()
  })
})

describe('on a narrow screen', () => {
  beforeEach(() => wideScreen(false))

  it('opens each paper over the page and closes it again', async () => {
    await open()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read the claim in this paper' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('paperA.pdf|We show Y improves recall [4].')
    fireEvent.click(screen.getByRole('button', { name: 'close paperA.pdf' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Read the reference' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('refB.pdf|recall rose by 4 points')
    fireEvent.click(screen.getByRole('button', { name: 'close refB.pdf' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('lists the shortcuts in the panel and keeps the save bar below', async () => {
    await open()
    expect(screen.getByRole('list', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save labels/ })).toBeInTheDocument()
  })

  it('has nothing to open for the reference when the claim has no reference at all', async () => {
    gateway.session = makeSession({ references: [], unread: [], claims: [makeSession().claims[1]] })
    await open()
    expect(screen.getByRole('button', { name: 'Read the reference' })).toBeDisabled()
    expect(screen.queryByLabelText('Open reference')).not.toBeInTheDocument()
  })

  it('keeps unread citations visible while the mobile web reference overlay is open', async () => {
    const url = 'https://example.org/article'
    const page = makeSession()
    page.claims[0] = {
      ...page.claims[0],
      cited: ['b5', 'b9'],
      candidates: [{
        cand_id: 'web-candidate', reference_id: 'web-b5', reference_file: 'web-b5', rank: 1,
        score: 1, page: null, paragraph: 2, passage: 'Static text from the cited page.', locator: `${url}#finding`,
      }],
    }
    page.references = [{
      reference_id: 'web-b5', file: 'web-b5', label: 'Useful page', ref: 'b5', source_kind: 'web-page', url,
    }]
    page.unread = [{ reference_id: 'missing-b9', file: '', label: 'Unread work', ref: 'b9' }]
    gateway.session = page
    await open()

    const unread = screen.getByRole('region', { name: 'Reference not found' })
    expect(unread).toHaveTextContent('Unread work')
    fireEvent.click(screen.getByRole('button', { name: 'Read the reference' }))
    expect(screen.getByRole('region', { name: 'Web source evidence' })).toHaveTextContent('Static text from the cited page.')
    expect(screen.getByRole('region', { name: 'Reference not found' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close reference' }))
    expect(screen.queryByRole('region', { name: 'Web source evidence' })).not.toBeInTheDocument()
  })
})

describe('the screen size', () => {
  it('switches layout when the window crosses the width the workspace needs', async () => {
    const listeners: (() => void)[] = []
    let matches = true
    window.matchMedia = vi.fn(() => ({
      get matches() {
        return matches
      },
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    await open()
    expect(screen.queryByRole('button', { name: 'Read the claim in this paper' })).not.toBeInTheDocument()
    matches = false
    act(() => listeners.forEach((listener) => listener()))
    expect(screen.getByRole('button', { name: 'Read the claim in this paper' })).toBeInTheDocument()
  })
})

describe('claims added by hand', () => {
  const handAdded = () => makeSession({ saved: SAVED_HAND_ADDED })

  it('searches the references for a claim when it is opened, and lists what was found', async () => {
    gateway.session = handAdded()
    gateway.found = [{ cand_id: 'f1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 1, score: 5, page: 3, passage: 'found by search' }]
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 4,/ }))
    await waitFor(() => expect(reference()).toBe('refB.pdf|found by search'))
    expect(gateway.searches).toEqual([{ claim_id: 'paperA#h-1', claim: 'A claim I added.' }])
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('lists a found passage once, though the claim already had it', async () => {
    gateway.session = makeSession({
      saved: {
        ...SAVED_HAND_ADDED,
        candidates: [{ claim_id: 'paperA#h-1', origin: 'retrieved_added', cand_id: 'f1', status: 'relevant', reference_id: 'refB', rank: '1', score: '5', page: '3', passage: 'found by search' }],
      },
    })
    gateway.found = [{ cand_id: 'f1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 1, score: 5, page: 3, passage: 'found by search' }]
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 4,/ }))
    await waitFor(() => expect(gateway.searches).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: /found by search/ })).toHaveLength(1)
    expect(reference()).toBe('refB.pdf|found by search')
  })

  it('says when the search failed, and searches again', async () => {
    gateway.session = handAdded()
    gateway.searchFails = true
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 4,/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Search again' }))
    await waitFor(() => expect(gateway.searches).toHaveLength(2))
  })

  it('keeps the passage the person opened when the search answers later', async () => {
    gateway.session = handAdded()
    gateway.found = [{ cand_id: 'f1', reference_id: 'refB', reference_file: 'refB.pdf', rank: 1, score: 5, page: 3, passage: 'found by search' }]
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 4,/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    fireEvent.change(screen.getByLabelText('The passage'), { target: { value: 'mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    await waitFor(() => expect(gateway.searches).toHaveLength(1))
    expect(reference()).toBe('refB.pdf|mine')
  })

  it('adds a claim the extraction missed, and looks for its passages', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A brand new claim' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add claim' }))
    await waitFor(() => expect(heading()).toBe('Claim 4 of 4 · added'))
    await waitFor(() => expect(gateway.searches).toHaveLength(1))
    expect(screen.getByRole('radio', { name: /Keep/ })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('an extracted claim the analysis stored no passages for', () => {
  const bare = (over: Record<string, unknown> = {}) => ({
    claim_id: 'paperA#7',
    claim: 'Following the text-to-text approach of T5.',
    sentence: 'Following the text-to-text approach of T5.',
    section: '3',
    source: null,
    candidates: [],
    ...over,
  })
  const found = {
    cand_id: 't5',
    reference_id: 'refB',
    reference_file: 'refB.pdf',
    rank: 1,
    score: 12,
    page: 3,
    passage: 'text-to-text figure',
  }

  it('searches when it is opened and saves the passages as retrieved_added', async () => {
    gateway.session = makeSession({ claims: [bare()] })
    gateway.found = [found]
    await open()
    await waitFor(() => expect(reference()).toBe('refB.pdf|text-to-text figure'))
    expect(gateway.searches).toEqual([{ claim_id: 'paperA#7', claim: 'Following the text-to-text approach of T5.' }])
    // Passages are listed once the claim is kept. Until then only the reference is open.
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.getByRole('button', { name: /text-to-text figure/ })).toHaveTextContent(/p\.\s*3/)
    fireEvent.click(screen.getByRole('radio', { name: /^Relevant/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(gateway.posts).toHaveLength(1))
    expect(gateway.posts[0].candidates).toEqual([
      {
        claim_id: 'paperA#7',
        reference_id: 'refB',
        cand_id: 't5',
        origin: 'retrieved_added',
        status: 'relevant',
        rank: 1,
        score: 12,
        page: 3,
        passage: 'text-to-text figure',
      },
    ])
  })

  it('shows passages saved earlier and does not search again', async () => {
    gateway.session = makeSession({
      claims: [bare()],
      saved: {
        claims: [],
        labels: [],
        candidates: [{ ...found, claim_id: 'paperA#7', origin: 'retrieved_added', status: 'relevant', rank: '1', score: '12', page: '3' }],
      },
    })
    await open()
    expect(reference()).toBe('refB.pdf|text-to-text figure')
    expect(gateway.searches).toEqual([])
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(screen.getByRole('button', { name: /text-to-text figure/ })).toHaveTextContent(/p\.\s*3/)
    expect(screen.getByRole('radio', { name: /^Relevant/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('says why each citation was not checked when nothing is found', async () => {
    gateway.session = makeSession({
      claims: [
        bare({
          claim: 'SuperGLUE is a hard benchmark.',
          unchecked: [
            { ref: 'b49', label: 'SuperGLUE', reason: 'named' },
            { ref: 'b4', label: 'NeurIPS', reason: 'no-open-access' },
          ],
        }),
      ],
    })
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    expect(await screen.findByText('SuperGLUE: not checked, the paper only names it')).toBeInTheDocument()
    expect(screen.getByText('NeurIPS: no open-access PDF')).toBeInTheDocument()
    expect(screen.queryByText(/Retrieval found nothing/)).not.toBeInTheDocument()
    expect(gateway.searches).toEqual([{ claim_id: 'paperA#7', claim: 'SuperGLUE is a hard benchmark.' }])
  })

  it('does not search an extracted claim that already has passages', async () => {
    await open()
    expect(gateway.searches).toEqual([])
    key(']')
    await waitFor(() => expect(gateway.searches).toEqual([{ claim_id: 'paperA#1', claim: 'Y is fast.' }]))
    key(']')
    await waitFor(() => expect(heading()).toBe('Claim 3 of 3'))
    expect(gateway.searches).toEqual([{ claim_id: 'paperA#1', claim: 'Y is fast.' }])
  })
})

describe('work kept from an earlier visit', () => {
  it('puts back the drafts and the claims added by hand, and says so', async () => {
    const added = { claim_id: 'paperA#h-9', claim: 'Typed last time', sentence: '', section: '', source: null, candidates: [], origin: 'human_added', page: null }
    window.localStorage.setItem(
      'labeler.unsaved.a1.chanya',
      JSON.stringify({
        drafts: {
          'paperA#0': { status: 'accepted', edited: '', cands: {}, added: [{ reference_id: 'ghost', page: null, passage: 'lost' }], labels: {} },
          'paperA#h-9': { status: 'accepted', edited: '', cands: {}, added: [], labels: {} },
        },
        added: [added, { ...added, claim_id: 'paperA#0' }],
      }),
    )
    const onDirtyChange = vi.fn()
    await open({ onDirtyChange })
    expect(screen.getByText(/Unsaved labels from your last visit were kept in this browser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim 4, in progress, unsaved: Typed last time/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Claim 5/ })).not.toBeInTheDocument()
    expect(screen.getByText('How well does ghost support the claim?')).toBeInTheDocument()
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
  })
})

describe('a blind check', () => {
  it('says so, hides the review and the questions, and keeps the labels free', async () => {
    gateway.session = makeSession({ blind: true })
    const slot = document.body.appendChild(document.createElement('div'))
    await open({ askSlot: slot })
    expect(screen.getByRole('note')).toHaveTextContent('Blind check')
    expect(slot).toHaveTextContent('Review and Ask are off on a blind check.')
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
    slot.remove()
  })

  it('offers no Ask button on the passages', async () => {
    gateway.session = makeSession({ blind: true })
    const slot = document.body.appendChild(document.createElement('div'))
    await open({ askSlot: slot, onOpenAsk: vi.fn() })
    key('k')
    expect(screen.queryAllByRole('button', { name: 'Ask AI about this passage' })).toHaveLength(0)
    slot.remove()
  })
})

describe('Ask about the claim', () => {
  async function openWithAsk(onOpenAsk?: () => void) {
    const slot = document.body.appendChild(document.createElement('div'))
    const view = await open({ askSlot: slot, onOpenAsk })
    return { slot, ...view }
  }

  it('can review only a claim that is saved with no changes', async () => {
    const { slot } = await openWithAsk()
    expect(slot).toHaveTextContent('Save this claim first: the review checks what you saved.')
    key(']')
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await screen.findByText('Saved 4 rows')
    await waitFor(() => expect(within(slot).getByRole('button', { name: 'Review' })).toBeEnabled())
    key('k')
    await waitFor(() => expect(slot).toHaveTextContent('Save your changes first: the review checks what you saved.'))
    slot.remove()
  })

  it('opens the Ask panel on a passage, asks again about another, and drops it on another claim', async () => {
    const onOpenAsk = vi.fn()
    const { slot } = await openWithAsk(onOpenAsk)
    key('k')
    const asks = screen.getAllByRole('button', { name: 'Ask AI about this passage' })
    fireEvent.click(asks[0])
    expect(onOpenAsk).toHaveBeenCalledTimes(1)
    expect(within(slot).getByText('#1 Ref B · p.5')).toBeInTheDocument()

    fireEvent.click(asks[1])
    expect(within(slot).getByText('#2 Ref B · p.2')).toBeInTheDocument()
    fireEvent.click(within(slot).getByRole('button', { name: 'Stop asking about this passage' }))
    expect(within(slot).queryByText('#2 Ref B · p.2')).not.toBeInTheDocument()

    fireEvent.click(asks[0])
    key(']')
    expect(within(slot).queryByText('#1 Ref B · p.5')).not.toBeInTheDocument()
    slot.remove()
  })

  it('words the passage question with the person’s edit of the claim', async () => {
    const { slot } = await openWithAsk(vi.fn())
    key('e')
    fireEvent.change(screen.getByRole('textbox', { name: 'The claim, as it should read' }), { target: { value: 'Y improves recall a lot.' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask AI about this passage' })[0])
    expect(within(slot).getByText('#1 Ref B · p.5')).toBeInTheDocument()
    slot.remove()
  })

  it('draws nothing in a slot that is not there, and keeps the pointing for the claim it was for', async () => {
    await open({ askSlot: null })
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })
})

describe('the progress bar', () => {
  it('counts the claims finished and saved', async () => {
    await open()
    expect(screen.getByRole('progressbar', { name: 'Claims finished' })).toHaveAttribute('aria-valuenow', '0')
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save labels/ }))
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Claims finished' })).toHaveAttribute('aria-valuenow', '1'))
    expect(screen.getByText('1 of 3 claims finished')).toBeInTheDocument()
  })
})

describe('a claim with no passages', () => {
  const TOP500 = { ref: 'b23', label: 'Top500', reason: 'not-downloadable', url: 'https://www.top500.org/', doi: '', year: '2021' }
  const bare = (over: Record<string, unknown> = {}) => ({
    claim_id: 'paperA#0',
    claim: 'GPU systems make up six of the ten fastest.',
    sentence: 'GPU-based systems make up six of the ten most powerful HPC systems.',
    section: '1',
    source: null,
    candidates: [],
    ...over,
  })
  const papersShown = () => screen.getAllByTestId('viewer').map((viewer) => viewer.textContent)

  it('lists the work it cites that could not be read, and opens no reference another claim cites', async () => {
    // Ref B is the analysis's first reference, read for some other claim.
    gateway.session = makeSession({ claims: [bare({ cited: ['b23'], unchecked: [TOP500] })] })
    await open()
    const pane = within(screen.getByRole('region', { name: 'Reference not found' }))
    expect(pane.getByRole('listitem')).toHaveTextContent('[b23] Top500 (2021)')
    expect(pane.getByRole('listitem')).toHaveTextContent('Not read: the PDF would not download')
    expect(pane.getByRole('link', { name: /top500\.org/ })).toHaveAttribute('href', 'https://www.top500.org/')
    expect(papersShown()).toEqual(['paperA.pdf|GPU-based systems make up six of the ten most powerful HPC systems.'])
    expect(screen.queryByText('No reference paper')).toBeNull()
  })

  it('opens the reference it cites that has a PDF, on page 1, not the analysis’s first one', async () => {
    gateway.session = makeSession({ claims: [bare({ cited: ['b23', 'b8'], unchecked: [TOP500] })] })
    await open()
    expect(reference()).toBe('refD.pdf|')
    expect(screen.getAllByTestId('viewer-heading')[0]).toHaveTextContent('refD.pdf: Reference [b8]: Ref D / opens on page 1')
    expect(screen.getByRole('region', { name: 'Reference not found' })).toBeInTheDocument()
  })

  it('goes by the markers in its sentence when the gateway is older than the list of what it cites', async () => {
    gateway.session = makeSession({ claims: [bare({ sentence: 'Six of the ten fastest are GPU systems [b8].' })] })
    await open()
    expect(reference()).toBe('refD.pdf|')
  })

  it('says "No reference paper" when it cites nothing, and a claim with passages still opens its own reference', async () => {
    await open()
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
    key(']')
    expect(heading()).toBe('Claim 2 of 3')
    expect(screen.getByText('No reference paper')).toBeInTheDocument()
    expect(screen.getByText('This claim cites no paper.')).toBeInTheDocument()
    expect(papersShown()).toEqual(['paperA.pdf|Y is fast.'])
    key('[')
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
  })

  it('still opens any read reference from the list', async () => {
    gateway.session = makeSession({ claims: [bare({ cited: ['b23'], unchecked: [TOP500] })] })
    await open()
    fireEvent.change(screen.getByLabelText('Open reference'), { target: { value: 'refB' } })
    expect(reference()).toBe('refB.pdf|')
    expect(screen.getByRole('region', { name: 'Reference not found' })).toBeInTheDocument()
  })
})
