/** The labeling workspace beyond labeling.test.tsx: keyboard, saving on, narrow screens, selections,
 * claims added by hand, work kept from an earlier visit, and blind checks. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  session: {} as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  sessionError: '',
  posts: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  saveFails: false,
  saveHangs: false,
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
    if (init?.method === 'POST') {
      if (gateway.saveHangs) await new Promise(() => undefined)
      if (gateway.saveFails) throw new Error('503: not set up')
      gateway.posts.push(JSON.parse(String(init.body)))
      return { claims: 1, candidates: 2, labels: 1 }
    }
    if (path.startsWith('/labeling/sessions/')) {
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
    embedded,
  }: {
    target: { paper: string; quote?: string; label: string; detail?: string; source?: { page: number } | null; error?: string; page?: number }
    onSelectText?: (s: { text: string; page: number | null }) => void
    onClose?: () => void
    markers?: { ref: string; text: string }[]
    onCitation?: (marker: { ref: string; text: string }) => void
    embedded?: boolean
  }) => (
    <div>
      <div data-testid="viewer" data-embedded={embedded}>
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
const reference = () => screen.getAllByTestId('viewer').at(-1)!.textContent
const wideScreen = (matches: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

beforeEach(() => {
  gateway.session = makeSession()
  gateway.sessionError = ''
  gateway.posts.length = 0
  gateway.saveFails = false
  gateway.saveHangs = false
  gateway.searches.length = 0
  gateway.found = []
  gateway.searchFails = false
  gateway.locate = 'page'
  window.localStorage.clear()
  window.localStorage.setItem('labeler.paperView', 'both')
  wideScreen(true)
})
afterEach(() => vi.restoreAllMocks())

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
    expect(screen.getByRole('button', { name: /Keep/ })).toBeInTheDocument()
    key('e')
    const box = await screen.findByRole('textbox', { name: 'The claim, as it should read' })
    expect(box).toHaveValue('Method Y improves recall.')
    fireEvent.keyDown(box, { key: 'x' })
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument()
    key('x')
    expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('tab', { name: /Ref B/ }))
    const [first, second] = screen.getAllByRole('radiogroup', { name: /^Passage \d of Ref B$/ })
    expect(within(first).getByRole('radio', { name: /^Relevant/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(second).getByRole('radio', { name: /^Not relevant/ })).toHaveAttribute('aria-checked', 'true')
    key('j')
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
    fireEvent.change(screen.getByLabelText('Open reference'), { target: { value: 'refC' } })
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

  it('does not give level 3 to a reference with no relevant passage', async () => {
    await open()
    key('k')
    key('r') // focus moves on to the second passage of Ref B
    key('j') // and then to Ref C's
    key('3')
    expect(screen.queryByRole('radio', { name: '3 · Clear' })).not.toBeInTheDocument()
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
    await screen.findByText('Saved')
    key('s', { ctrlKey: true })
    expect(gateway.posts).toHaveLength(1)
  })

  it('names the reference in the level notice by the number the paper prints', async () => {
    await open()
    key('k')
    key('r')
    key('3')
    expect(screen.getByRole('status')).toHaveTextContent('[4] level 3 Clear · Z to undo')
  })

  it('shows and hides the shortcut list with a question mark', async () => {
    await open()
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    key('?')
    expect(screen.getByRole('region', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    key('?')
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
  })

  it('puts focus back on the shortcuts button when Escape closes the list', async () => {
    await open()
    key('?')
    expect(screen.getByRole('region', { name: 'Keyboard shortcuts' })).toHaveFocus()
    key('Escape')
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveFocus()
  })

  it('carries on when the browser will not remember view choices', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }))
    expect(screen.getByRole('button', { name: 'Stacked' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('saving', () => {
  it('can reopen the claim list after finishing the paper', async () => {
    wideScreen(false)
    const onlyClaim = makeSession().claims[1]
    gateway.session = makeSession({ claims: [onlyClaim] })
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    expect(await screen.findByText('This paper is labeled')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review claims' }))
    expect(screen.getByRole('heading', { name: 'Claim 1 of 1' })).toBeInTheDocument()
  })

  it('saves to the next unfinished claim and wraps to the first unfinished claim', async () => {
    await open()
    key(']')
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    await waitFor(() => expect(heading()).toBe('Claim 3 of 3'))
    expect(gateway.posts).toHaveLength(1)
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    await waitFor(() => expect(heading()).toBe('Claim 1 of 3'))
    expect(gateway.posts).toHaveLength(2)
  })

  it('stays on the claim after Save labels', async () => {
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await screen.findByText('Saved')
    expect(heading()).toBe('Claim 1 of 3')
  })

  it('says why a save failed and keeps the draft', async () => {
    gateway.saveFails = true
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: Labels cannot be saved yet.')
    expect(screen.getByText('Unsaved · Ctrl/⌘+S')).toBeInTheDocument()
  })

  it('does not move to another claim while a save is running', async () => {
    gateway.saveHangs = true
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toBeDisabled())
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
    await waitFor(() => expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('boxed on page 3'))
    expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('refB.pdf: Reference [4]: Ref B / Silva, Lee · 2021')
    expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('opens on page 5')
  })

  it('names a reference with no marker plainly, and opens on page 1 for a passage with no page', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getByRole('tab', { name: 'Ref C' }))
    fireEvent.click(screen.getAllByRole('button', { name: /a different study/ })[0])
    expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('refC.pdf: Reference: Ref C')
    expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('opens on page 1')
  })

  it('shows the passage unboxed when it was not found, and says so when the look-up failed', async () => {
    gateway.locate = 'none'
    const { unmount } = await open()
    await waitFor(() => expect(screen.getAllByTestId('viewer-heading').at(-1)!).not.toHaveTextContent('boxed'))
    unmount()

    gateway.locate = 'fail'
    await open()
    await waitFor(() => expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('error: Could not look up where this passage is.'))
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
    expect(within(picker).getByRole('option', { name: '[4] Ref B' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Ref C' })).toBeInTheDocument()
    fireEvent.change(picker, { target: { value: 'refC' } })
    expect(reference()).toBe('refC.pdf|')
  })

  it('names a passage from a file the analysis did not list, and takes no evidence from it', async () => {
    await open()
    key(']')
    key(']')
    key('k')
    const heading0 = screen.getAllByTestId('viewer-heading').at(-1)!
    expect(heading0).toHaveTextContent('orphan.pdf: Reference /')
    const picker = screen.getByLabelText('Open reference')
    expect(within(picker).getByRole('option', { name: 'Open reference…' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Keep/ })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Keep/ })).toBeInTheDocument()
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
    expect(screen.getAllByText('How well does [4] support the claim?').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove this passage' }))
    expect(screen.queryByText('Passages you added')).not.toBeInTheDocument()
  })

  it('takes a passage for a cited work with no PDF, which opens in no viewer', async () => {
    await open()
    key(']')
    key('k')
    // The line shows once the search for passages has come back empty.
    expect(await screen.findByText(/^No passages: /)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing to label yet/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Also labeled by Somchai. Their levels are hidden.')).toBeInTheDocument()
  })
})

describe('on a narrow screen', () => {
  beforeEach(() => wideScreen(false))

  it('opens each paper over the page and closes it again', async () => {
    await open()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read the claim in this paper' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('paperA.pdf|We show Y improves recall [4].')
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-embedded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'close paperA.pdf' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Read the reference' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('refB.pdf|recall rose by 4 points')
    fireEvent.click(screen.getByRole('button', { name: 'close refB.pdf' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('keeps the save bar below on a narrow screen', async () => {
    await open()
    expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toBeInTheDocument()
  })

  it('has nothing to open for the reference when the claim has no reference at all', async () => {
    gateway.session = makeSession({ references: [], unread: [], claims: [makeSession().claims[1]] })
    await open()
    expect(screen.getByRole('button', { name: 'Read the reference' })).toBeDisabled()
    expect(screen.queryByLabelText('Open reference')).not.toBeInTheDocument()
  })
})

describe('the screen size', () => {
  it.each([1024, 1279])('embeds both viewers and keeps the label controls available at %ipx', async (width) => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: width >= Number(query.match(/\d+/)?.[0]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    await open()
    const viewers = screen.getAllByTestId('viewer')
    expect(viewers).toHaveLength(2)
    viewers.forEach((viewer) => expect(viewer).toHaveAttribute('data-embedded', 'true'))
    const viewToggle = screen.getByRole('group', { name: 'Which papers to show' })
    expect(screen.getByRole('radio', { name: /^Keep/ })).toBeEnabled()
    fireEvent.click(within(viewToggle).getByRole('button', { name: 'Reference only' }))
    expect(screen.getAllByTestId('viewer').at(-1)).toHaveAttribute('data-embedded', 'true')
  })

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
    expect(screen.getByRole('button', { name: /Keep/ })).toHaveAttribute('aria-expanded', 'false')
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
    expect(screen.getByRole('button', { name: /Keep/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('clears the decision on a claim added by hand, which has nothing saved to go back to', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A brand new claim' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add claim' }))
    await waitFor(() => expect(heading()).toBe('Claim 4 of 4 · added'))
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'Clear decision' }))
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear decision' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /text-to-text figure/ })).toHaveTextContent(/page\s*3/)
    fireEvent.click(screen.getByRole('radio', { name: /^Relevant/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
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
    expect(screen.getByRole('button', { name: /text-to-text figure/ })).toHaveTextContent(/page\s*3/)
    expect(screen.getByRole('radio', { name: /^Relevant/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('says how many cited works could not be read when nothing is found', async () => {
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
    expect(await screen.findByText(/^No passages: /)).toBeInTheDocument()
    expect(screen.queryByText(/not checked, the paper only names it/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /^Claim 4, in progress, unsaved, no reference to read: Typed last time/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Claim 5/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'ghost' }))
    expect(screen.getByText('How well does this reference support the claim?')).toBeInTheDocument()
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
  })
})

describe('a blind check', () => {
  it('says so, hides the review and the questions, and keeps the labels free', async () => {
    gateway.session = makeSession({ blind: true })
    const slot = document.body.appendChild(document.createElement('div'))
    await open({ askSlot: slot })
    expect(screen.getByRole('note')).toHaveTextContent(
      'Blind check: someone else labeled this paper. Their labels are hidden until you finish, and Review and Ask are off.',
    )
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
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    await screen.findByText('Saved')
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
    expect(within(slot).getByText('Passage 1 · Ref B · p.5')).toBeInTheDocument()

    fireEvent.click(asks[1])
    expect(within(slot).getByText('Passage 2 · Ref B · p.2')).toBeInTheDocument()
    fireEvent.click(within(slot).getByRole('button', { name: 'Stop asking about this passage' }))
    expect(within(slot).queryByText('Passage 2 · Ref B · p.2')).not.toBeInTheDocument()

    fireEvent.click(asks[0])
    key(']')
    expect(within(slot).queryByText('Passage 1 · Ref B · p.5')).not.toBeInTheDocument()
    slot.remove()
  })

  it('words the passage question with the person’s edit of the claim', async () => {
    const { slot } = await openWithAsk(vi.fn())
    key('e')
    fireEvent.change(screen.getByRole('textbox', { name: 'The claim, as it should read' }), { target: { value: 'Y improves recall a lot.' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask AI about this passage' })[0])
    expect(within(slot).getByText('Passage 1 · Ref B · p.5')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
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
    const pane = within(screen.getByRole('region', { name: /^No reference to read/ }))
    expect(pane.getByRole('listitem')).toHaveTextContent('Top500 (2021)')
    expect(pane.getByRole('listitem')).toHaveTextContent('Not read: the PDF would not download')
    expect(pane.getByRole('link', { name: /top500\.org/ })).toHaveAttribute('href', 'https://www.top500.org/')
    expect(papersShown()).toEqual(['paperA.pdf|GPU-based systems make up six of the ten most powerful HPC systems.'])
    expect(screen.queryByText('No reference paper')).toBeNull()
  })

  it('opens the reference it cites that has a PDF, on page 1, not the analysis’s first one', async () => {
    gateway.session = makeSession({ claims: [bare({ cited: ['b23', 'b8'], unchecked: [TOP500] })] })
    await open()
    expect(reference()).toBe('refD.pdf|')
    expect(screen.getAllByTestId('viewer-heading').at(-1)!).toHaveTextContent('refD.pdf: Reference: Ref D / opens on page 1')
    expect(screen.queryByRole('region', { name: /^No reference to read/ })).toBeNull()
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
    expect(screen.queryByRole('region', { name: /^No reference to read/ })).toBeNull()
  })
})

describe('the notice for the last action', () => {
  const notice = () => screen.queryByText(/Z to undo|^Undone|^Change discarded|^Decision cleared/)

  it('names the action a key took and what Z took back', async () => {
    await open()
    key('x')
    expect(screen.getByText('Reject · Z to undo')).toBeInTheDocument()
    key('z')
    expect(screen.getByText('Undone: Reject')).toBeInTheDocument()
  })

  it('goes away by itself after four seconds', async () => {
    await open()
    vi.useFakeTimers()
    try {
      key('k')
      expect(screen.getByText('Keep · Z to undo')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(3999))
      expect(notice()).not.toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(notice()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes away when another choice is made', async () => {
    await open()
    key('k')
    expect(notice()).not.toBeNull()
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    expect(notice()).toBeNull()
  })

  it('stays while the person types the claim wording', async () => {
    await open()
    key('e')
    fireEvent.change(screen.getByLabelText('The claim, as it should read'), { target: { value: 'Y raises recall.' } })
    expect(screen.getByText('Edit · Z to undo')).toBeInTheDocument()
  })

  it('goes away when the person picks another view of the papers', async () => {
    await open()
    key('k')
    fireEvent.click(within(screen.getByRole('group', { name: 'Which papers to show' })).getByRole('button', { name: 'Reference only' }))
    expect(notice()).toBeNull()
  })
})

describe('undoing more than one step', () => {
  it('walks back one step per press, naming each, until nothing is left', async () => {
    await open()
    key('k')
    key('x')
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Reject')
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Keep')
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to undo')
  })

  it('keeps the last 20 steps of a claim', async () => {
    await open()
    for (let i = 0; i < 22; i++) key(i % 2 ? 'k' : 'x')
    for (let i = 0; i < 20; i++) key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone')
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to undo')
  })

  it.each([
    ['Keep', /^Keep/],
    ['Edit', /^Edit/],
    ['Reject', /^Reject/],
  ])('names a click on %s when it is undone', async (what, name) => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent(`Undone: ${what}`)
  })

  it('takes back a level chosen in the form', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    key('z')
    expect(screen.getByRole('radio', { name: /3 · Clear/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('names a click on a passage verdict, and on the same verdict again', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage 1 relevant')

    fireEvent.click(screen.getAllByRole('radio', { name: /^Not relevant/ })[0])
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage 1 not relevant')

    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage 1 cleared')
  })
})

describe('the progress count in the header', () => {
  const next = () => screen.getByRole('button', { name: 'Next unfinished' })

  it('goes to the next unfinished claim after this one, not the first', async () => {
    await open()
    key(']')
    expect(heading()).toBe('Claim 2 of 3')
    fireEvent.click(next())
    expect(heading()).toBe('Claim 3 of 3')
    fireEvent.click(next())
    expect(heading()).toBe('Claim 1 of 3')
  })

  it('says how many claims have changes not saved yet', async () => {
    await open()
    expect(screen.getByText('· 0 unsaved')).toHaveClass('invisible')
    expect(screen.getByText('· 0 unsaved')).toHaveAttribute('aria-hidden', 'true')
    key('x')
    expect(screen.getByText('· 1 unsaved')).not.toHaveClass('invisible')
    expect(screen.getByText('· 1 unsaved')).not.toHaveAttribute('aria-hidden')
    key(']')
    key('x')
    expect(screen.getByText('· 2 unsaved')).toBeInTheDocument()
  })

  it('has nowhere to go when every claim is finished', async () => {
    gateway.session = makeSession({
      saved: { claims: ['paperA#0', 'paperA#1', 'paperA#2'].map((claim_id) => ({ claim_id, status: 'rejected' })), candidates: [], labels: [] },
    })
    await open()
    expect(next()).toBeDisabled()
  })
})

describe('an edit that is not a new wording', () => {
  it('cannot be saved, by button or by Ctrl+S, until the claim is reworded', async () => {
    await open()
    key('e')
    const title = "Can't save yet: reword the claim, or choose Keep."
    expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toHaveAttribute('title', title)
    expect(screen.getByText(title, { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Save claim \d+ and next$/ })).toBeDisabled()
    key('s', { ctrlKey: true })
    expect(gateway.posts).toEqual([])

    fireEvent.change(screen.getByLabelText('The claim, as it should read'), { target: { value: 'Y raises recall.' } })
    expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toBeEnabled()
  })
})

describe('Reference only on a claim with no reference', () => {
  const group = () => screen.getByRole('group', { name: 'Which papers to show' })

  it('is off, shows Stacked as the view in use, and does not overwrite the stored choice', async () => {
    window.localStorage.setItem('labeler.paperView', 'reference')
    await open()
    key(']')
    expect(within(group()).getByRole('button', { name: 'Reference only' })).toBeDisabled()
    expect(within(group()).getByRole('button', { name: 'Reference only' })).toHaveAttribute('title', 'This claim has no reference to read')
    expect(within(group()).getByRole('button', { name: 'Stacked' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group()).getByRole('button', { name: 'Stacked' }))
    expect(window.localStorage.getItem('labeler.paperView')).toBe('reference')
  })
})

describe('a rejected claim that had passages judged', () => {
  const rejectAfterJudging = async (count: number) => {
    await open()
    key('k')
    const relevant = screen.getAllByRole('radio', { name: /^Relevant/ })
    for (const radio of relevant.slice(0, count)) fireEvent.click(radio)
    key('x')
  }

  it('says one passage is hidden, in the singular', async () => {
    await rejectAfterJudging(1)
    expect(screen.getByText('1 passage judged: hidden while the claim is rejected.')).toBeInTheDocument()
  })

  it('says how many passages are hidden, in the plural', async () => {
    await rejectAfterJudging(2)
    expect(screen.getByText('2 passages judged: hidden while the claim is rejected.')).toBeInTheDocument()
  })

  it('says nothing when none were judged', async () => {
    await open()
    key('x')
    expect(screen.queryByText(/judged: hidden/)).not.toBeInTheDocument()
  })
})

describe('Reference only on a claim with no reference to open', () => {
  const NOTE = 'No reference opens for this claim, so the paper under review is shown above.'

  it('shows the paper under review and says why, and not on a claim that has a reference', async () => {
    window.localStorage.setItem('labeler.paperView', 'reference')
    await open()
    expect(reference()).toBe('refB.pdf|recall rose by 4 points')
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
    key(']')
    expect(screen.getByText(NOTE)).toBeInTheDocument()
    expect(screen.getByText('No reference paper')).toBeInTheDocument()
    expect(screen.getAllByTestId('viewer').map((viewer) => viewer.textContent)).toEqual(['paperA.pdf|Y is fast.'])
  })
})

describe('the reference picker', () => {
  const claimCiting = (cited: string[]) => ({ ...makeSession().claims[1], sentence: 'Y is fast.', cited })
  const optionsOf = (group: HTMLElement) => within(group).getAllByRole('option').map((option) => option.textContent)

  it('groups what the claim cites above the other references', async () => {
    gateway.session = makeSession({ claims: [claimCiting(['b4'])] })
    await open()
    const picker = screen.getByLabelText('Open reference')
    expect(optionsOf(within(picker).getByRole('group', { name: 'Cited by this claim' }))).toEqual(['[4] Ref B'])
    expect(optionsOf(within(picker).getByRole('group', { name: 'Not cited by this claim' }))).toEqual(['Ref C', 'Ref D'])
  })

  it('leaves out the second group when the claim cites every reference', async () => {
    gateway.session = makeSession({
      claims: [claimCiting(['b4', 'b8'])],
      references: makeSession().references.filter((r) => r.reference_id !== 'refC'),
    })
    await open()
    const picker = screen.getByLabelText('Open reference')
    expect(within(picker).getByRole('group', { name: 'Cited by this claim' })).toBeInTheDocument()
    expect(within(picker).queryByRole('group', { name: 'Not cited by this claim' })).not.toBeInTheDocument()
  })

  it('puts every reference under "Not cited by this claim" when the claim cites none of them', async () => {
    gateway.session = makeSession({ claims: [claimCiting([])] })
    await open()
    const picker = screen.getByLabelText('Open reference')
    expect(within(picker).queryByRole('group', { name: 'Cited by this claim' })).not.toBeInTheDocument()
    expect(optionsOf(within(picker).getByRole('group', { name: 'Not cited by this claim' }))).toEqual(['[4] Ref B', 'Ref C', 'Ref D'])
  })
})

describe('undo and the keyboard focus', () => {
  const box = () => screen.getByRole('textbox', { name: 'The claim, as it should read' })
  const isTextField = (el: Element | null) => /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? '')

  it('focuses the reword box when the labeler picks Edit by click', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /^Edit/ }))
    expect(box()).toHaveFocus()
  })

  it('leaves the focus out of the reword box when Z brings Edit back', async () => {
    await open()
    key('e')
    box().blur()
    key('x')
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Reject')
    expect(box()).not.toHaveFocus()
    expect(isTextField(document.activeElement)).toBe(false)
    // The next keys act as shortcuts and never reach the claim's wording.
    fireEvent.keyDown(document.activeElement ?? window, { key: 'z' })
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Edit')
    fireEvent.keyDown(document.activeElement ?? window, { key: 'k' })
    expect(screen.getByRole('button', { name: /^Keep/ })).toBeInTheDocument()
    key('e')
    expect(box()).toHaveValue('Method Y improves recall.')
  })

  it('leaves the focus out of the reword box when Discard goes back to a saved Edit', async () => {
    gateway.session = makeSession({
      saved: { claims: [{ claim_id: 'paperA#0', status: 'edited', claim_edited: 'Y raises recall.' }], candidates: [], labels: [] },
    })
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes to this claim' }))
    expect(box()).toHaveValue('Y raises recall.')
    expect(isTextField(document.activeElement)).toBe(false)
  })
})

describe('Clear and Discard are one undo step', () => {
  const decision = () => screen.getByRole('radiogroup', { name: 'Decision on this claim' })

  it('Clear decision: one Z puts back the decision, verdicts, level, reason and confidence', async () => {
    await open()
    key('k')
    key('r')
    fireEvent.click(screen.getByRole('radio', { name: /^3 · Clear/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Why this level/ }), { target: { value: 'big sample' } })
    fireEvent.click(screen.getByRole('radio', { name: /^High/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear decision' }))
    expect(screen.getByRole('status')).toHaveTextContent(/^Decision cleared · Z to undo$/)
    // The button went away with the change; the focus is on the Keep card, not the page.
    expect(within(decision()).getByRole('radio', { name: /^Keep/ })).toHaveFocus()
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Clear decision')
    // Kept, the decision collapses to the one card that reopens it, which now has the focus.
    expect(screen.getByRole('button', { name: /^Keep/ })).toHaveFocus()
    expect(screen.getByRole('radio', { name: /^3 · Clear/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /^High/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('textbox', { name: /^Why this level/ })).toHaveValue('big sample')
    expect(within(screen.getByRole('radiogroup', { name: /^Passage 1 of/ })).getByRole('radio', { name: /^Relevant/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // The steps before the clear are still there, one per press.
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: ')
    expect(screen.getByRole('status')).not.toHaveTextContent('Nothing to undo')
  })

  it('says Nothing to undo only once the stack is empty', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getByRole('button', { name: 'Clear decision' }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Clear decision')
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Keep')
    expect(within(decision()).getByRole('radio', { name: /^Keep/ })).toHaveFocus()
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to undo')
  })

  it('Discard: Z brings the unsaved change back over the saved Keep', async () => {
    gateway.session = makeSession({ saved: { claims: [{ claim_id: 'paperA#0', status: 'accepted' }], candidates: [], labels: [] } })
    await open()
    key('x')
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes to this claim' }))
    expect(screen.getByRole('status')).toHaveTextContent(/^Changes discarded · Z to undo$/)
    expect(screen.getByRole('button', { name: /^Keep/ })).toHaveFocus()
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Discard changes')
    expect(screen.getByRole('button', { name: /^Reject/ })).toHaveFocus()
  })

  it('counts the changes it would discard when there is more than one', async () => {
    gateway.session = makeSession({ saved: { claims: [{ claim_id: 'paperA#0', status: 'accepted' }], candidates: [], labels: [] } })
    await open()
    key('r')
    expect(screen.getByRole('button', { name: 'Discard changes to this claim' })).toBeInTheDocument()
    key('r')
    expect(screen.getByRole('button', { name: 'Discard 2 changes to this claim' })).toBeInTheDocument()
  })
})

describe('what an undo put back', () => {
  afterEach(() => vi.useRealTimers())

  it('outlines the decision for a moment and keeps its notice until the next action', async () => {
    await open()
    vi.useFakeTimers()
    key('k')
    key('x')
    key('z')
    const section = document.getElementById('claim-decision') as HTMLElement
    expect(section.style.outline).toContain('solid')
    act(() => vi.advanceTimersByTime(1600))
    expect(section.style.outline).toBe('')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Reject')
    key('e')
    expect(screen.getByRole('status')).toHaveTextContent('Edit · Z to undo')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('outlines the passage whose verdict it put back', async () => {
    await open()
    key('k')
    key('r')
    key('z')
    const passage = document.querySelector<HTMLElement>('[data-ask-target="passage:c1"]')
    expect(passage?.style.outline).toContain('solid')
  })

  it('outlines the level form whose level it put back', async () => {
    await open()
    key('k')
    key('r')
    key('3')
    key('z')
    const form = document.querySelector<HTMLElement>('[data-ask-target="reference:refB"] [data-level-form]')
    expect(form?.style.outline).toContain('solid')
  })

  it('outlines nothing for an added passage', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'The passage' }), { target: { value: 'my passage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage added')
    expect(document.querySelectorAll<HTMLElement>('[style*="outline"]')).toHaveLength(0)
    key('z')
    const section = document.getElementById('claim-decision') as HTMLElement
    expect(section.style.outline).toContain('solid')
  })
})

describe('saving every unsaved claim', () => {
  const box = () => screen.getByRole('textbox', { name: 'The claim, as it should read' })
  const decide = async (n: number, k: string) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Claim ${n},`) }))
    await screen.findByRole('heading', { name: new RegExp(`^Claim ${n} of`) })
    key(k)
  }
  const unsavedMarks = () => screen.getAllByRole('button', { name: /^Claim \d+, .*unsaved/ }).length

  it('offers Save all only from two unsaved claims, and saves them in order', async () => {
    await open()
    key('k')
    expect(screen.queryByRole('button', { name: /^Save all/ })).not.toBeInTheDocument()
    await decide(2, 'x')
    await decide(3, 'x')
    expect(unsavedMarks()).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'Save all unsaved (3)' }))
    await waitFor(() => expect(gateway.posts).toHaveLength(3))
    expect(gateway.posts.map((post) => post.claims[0].claim_id)).toEqual(['paperA#0', 'paperA#1', 'paperA#2'])
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^3 saved$/))
    expect(screen.queryByRole('button', { name: /^Claim \d+, .*unsaved/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save all/ })).not.toBeInTheDocument()
  })

  it('skips a claim whose Edit is not reworded, and names it', async () => {
    await open()
    key('e')
    box().blur()
    await decide(2, 'x')
    await decide(3, 'x')
    key('s', { ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(gateway.posts).toHaveLength(2))
    expect(gateway.posts.map((post) => post.claims[0].claim_id)).toEqual(['paperA#1', 'paperA#2'])
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/^2 saved · claim 1 not saved: reword the claim, or choose Keep$/),
    )
    expect(unsavedMarks()).toBe(1)
  })

  it('stops at the first failure and says which claims were saved and which not', async () => {
    let posts = 0
    const { request } = await import('../src/lib/api')
    const real = vi.mocked(request).getMockImplementation()!
    vi.mocked(request).mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST' && !path.endsWith('/candidates') && ++posts === 2) throw new Error('503: not set up')
      return real(path, init)
    })
    await open()
    key('k')
    await decide(2, 'x')
    await decide(3, 'e')
    box().blur()
    await decide(1, 'x')
    key('s', { metaKey: true, shiftKey: true })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Not saved: claim 2: .+ · claim 3 not saved: reword the claim, or choose Keep · claim 1 saved$/)
    expect(gateway.posts.map((post) => post.claims[0].claim_id)).toEqual(['paperA#0'])
    expect(unsavedMarks()).toBe(2)
    // The report is about that run: moving to another claim clears it.
    fireEvent.click(screen.getByRole('button', { name: /^Claim 2,/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names every claim left when the first save fails', async () => {
    gateway.saveFails = true
    await open()
    key('k')
    await decide(2, 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Save all unsaved (2)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Not saved: claims 1, 2: [^·]+$/)
  })

  it('says there is nothing to save, and does nothing while a save runs', async () => {
    await open()
    key('s', { ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to save')
    gateway.saveHangs = true
    key('k')
    key('s', { ctrlKey: true })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save claim 1$/ })).toBeDisabled())
    key('s', { ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('status')).not.toHaveTextContent('Nothing to save')
  })

  it('lists both save keys in the shortcuts panel', async () => {
    await open()
    key('?')
    const panel = screen.getByRole('region', { name: 'Keyboard shortcuts' })
    expect(panel).toHaveTextContent('Ctrl/⌘+S save this claim')
    expect(panel).toHaveTextContent('Ctrl/⌘+Shift+S save all unsaved')
  })
})

describe('cited works that could not be read', () => {
  it('folds them under the picker when another reference opens', async () => {
    gateway.session = makeSession({
      claims: [{ ...makeSession().claims[0], cited: ['b4', 'b9'] }],
      unread: [{ reference_id: 'refU', file: '', label: 'Ref U', ref: 'b9', reason: 'paywalled' }],
    })
    await open()
    const line = screen.getByText('1 cited work could not be read')
    expect(line.tagName).toBe('SUMMARY')
    expect(line.closest('details')).not.toHaveAttribute('open')
    expect(within(line.closest('details') as HTMLElement).getByText('Ref U')).toBeInTheDocument()
  })
})

describe('side by side on a narrow window', () => {
  let callback: () => void = () => undefined
  let width = 400
  beforeEach(() => {
    window.localStorage.setItem('labeler.paperView', 'side')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers Stacked when a pane is too narrow to read, and switches only when asked', async () => {
    await open()
    act(() => callback())
    expect(screen.getByRole('note')).toHaveTextContent('Too narrow for side by side')
    expect(within(screen.getByRole('group', { name: 'Which papers to show' })).getByRole('button', { name: 'Side by side' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show Stacked' }))
    expect(within(screen.getByRole('group', { name: 'Which papers to show' })).getByRole('button', { name: 'Stacked' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText(/Too narrow for side by side/)).not.toBeInTheDocument()
  })

  it('says nothing when both panes are wide enough', async () => {
    width = 700
    await open()
    act(() => callback())
    expect(screen.queryByText(/Too narrow for side by side/)).not.toBeInTheDocument()
    width = 400
  })
})

describe('undo names a level or confidence chosen in the form', () => {
  const judgeFirst = async () => {
    await open()
    key('k')
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
  }

  it('names a level, as the key notice does', async () => {
    await judgeFirst()
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: [4] level 3 Clear')
  })

  it('names a level taken back by choosing it again', async () => {
    await judgeFirst()
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    fireEvent.click(screen.getByRole('radio', { name: /3 · Clear/ }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: [4] level cleared')
  })

  it('names a confidence, and one taken back', async () => {
    await judgeFirst()
    fireEvent.click(screen.getByRole('radio', { name: /^Medium/ }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: [4] confidence Medium')
    fireEvent.click(screen.getByRole('radio', { name: /^High/ }))
    fireEvent.click(screen.getByRole('radio', { name: /^High/ }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: [4] confidence cleared')
  })

  it('keeps typing in the Why field off the undo steps', async () => {
    await judgeFirst()
    fireEvent.change(screen.getByLabelText(/^Why this level/), { target: { value: 'n = 12' } })
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage 1 relevant')
  })

  it('names a passage added or removed by hand', async () => {
    await open()
    key('k')
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    fireEvent.change(screen.getByLabelText('The passage'), { target: { value: 'my passage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    key('z')
    expect(screen.getByRole('status')).toHaveTextContent('Undone: Passage added')
  })
})

describe('single-key shortcuts while typing', () => {
  it.each(['?', 'z', 'k', '3', 'm', ']'])('ignores %s typed into the Why field', async (letter) => {
    await open()
    key('k')
    fireEvent.click(screen.getAllByRole('radio', { name: /^Relevant/ })[0])
    const why = screen.getByLabelText(/^Why this level/)
    why.focus()
    fireEvent.keyDown(why, { key: letter })
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(heading()).toBe('Claim 1 of 3')
    expect(screen.getByRole('radio', { name: /3 · Clear/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('ignores keys typed into an editable element', async () => {
    await open()
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not compute isContentEditable.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.append(editable)
    fireEvent.keyDown(editable, { key: 'x' })
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    editable.remove()
  })
})

describe('the note on an Edit not reworded yet', () => {
  const hint = () => screen.getByText('Reword the claim, or choose Keep', { selector: 'p' })
  const status = () => screen.getByText("Can't save yet: reword the claim, or choose Keep.", { selector: 'span' })

  it('is a hint at first, and a warning after Ctrl+S tries to save', async () => {
    await open()
    key('e')
    expect(hint()).toHaveClass('text-ink-muted')
    expect(status()).toHaveClass('text-ink-muted')
    key('s', { ctrlKey: true })
    expect(hint()).toHaveClass('text-refutes')
    expect(status()).toHaveClass('text-refutes')
    expect(gateway.posts).toEqual([])
    // A new decision starts over with the hint.
    key('k')
    key('e')
    expect(hint()).toHaveClass('text-ink-muted')
  })

  it('turns to a warning when the unchanged box loses focus, not after a rewording', async () => {
    await open()
    key('e')
    const box = () => screen.getByRole('textbox', { name: 'The claim, as it should read' })
    fireEvent.blur(box())
    expect(hint()).toHaveClass('text-refutes')
    key(']')
    key('[')
    expect(hint()).toHaveClass('text-ink-muted')
    fireEvent.change(box(), { target: { value: 'Y raises recall.' } })
    fireEvent.blur(box())
    expect(screen.queryByText('Reword the claim, or choose Keep', { selector: 'p' })).not.toBeInTheDocument()
  })
})
