/** AnalysisView: loading and failure, a running analysis, the results list with its filters and
 * sections, and the page viewer opened from a claim, the contents or the paper itself. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  findInPaper: vi.fn(),
}))

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/lib/useAnalysis', () => ({ useAnalysis: () => state.result }))
vi.mock('../src/lib/useAuthorizedUrl', () => ({ useAuthorizedUrl: () => ({ failed: false }) }))
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  api: { findInPaper: state.findInPaper, disputeVerdict: vi.fn() },
}))
vi.mock('../src/components/PageViewer', () => ({
  PageViewer: ({
    target,
    onClose,
    onLabel,
    markers,
    notice,
  }: {
    target: { paper: string; label: string; section?: string; page?: number }
    onClose: () => void
    onLabel?: () => void
    markers?: unknown[]
    notice?: ReactNode
  }) => (
    <div data-testid="viewer" data-paper={target.paper} data-section={target.section} data-markers={markers?.length ?? 'none'}>
      {target.label}
      <button onClick={onClose}>Close viewer</button>
      {onLabel && <button onClick={onLabel}>Back to claim</button>}
      {notice}
    </div>
  ),
}))

import { AnalysisView, type SectionJump } from '../src/components/AnalysisView'
import type { Analysis, Claim, Verdict } from '../src/lib/api'

const location = { page: 4, boxes: [{ x0: 1, y0: 2, x1: 3, y1: 4 }], page_width: 100, page_height: 200 }
const citation = { title: 'ColBERT', authors: ['Khattab'], year: '2020', doi: 'd1', arxiv: '', url: '' }
const verdict = (kind: Verdict['verdict'], extra: Partial<Verdict> = {}): Verdict => ({
  verdict: kind, quote: '', reasoning: `${kind} reasoning`, source: 'cited.pdf', cited: 'd1', evidence: [], ...extra,
})

const refuted: Claim = {
  claim: 'The refuted claim.', citations: [citation], section: '3.1', sentence: 'Paper sentence.', source: location,
  verdicts: [verdict('refutes', { quote: 'Cited says no.' })],
}
const backed: Claim = { claim: 'The backed claim.', citations: [citation], section: '2', verdicts: [verdict('supports')] }
const pendingClaim: Claim = { claim: 'Still being checked.', citations: [citation] }

const outline = [
  { n: '2', title: 'Method', page: 3, y: 0 },
  { n: '3.1', title: 'Encoder', page: 4, y: 0 },
]

function analysis(extra: Partial<Analysis> = {}): Analysis {
  return {
    id: 'a1', paper: 'p.pdf', file: 'dir/mine.pdf', status: 'done', claims: [refuted, backed], stages: [{ stage: 'done' }], outline,
    markers: [{ ref: 'b1', text: '[1]', page: 1, x0: 0, y0: 0, x1: 1, y1: 1, page_width: 10, page_height: 10 }],
    ...extra,
  }
}

function load(data: Analysis | undefined, flags: Record<string, unknown> = {}) {
  state.result = { data, isPending: false, isError: false, ...flags }
}

type Props = Partial<React.ComponentProps<typeof AnalysisView>>
function view(props: Props = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrap = (ui: ReactNode) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  const result = render(wrap(<AnalysisView id="a1" {...props} />))
  return { ...result, again: (next: Props) => result.rerender(wrap(<AnalysisView id="a1" {...props} {...next} />)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.findInPaper.mockResolvedValue({ page: null, boxes: [] })
  load(analysis())
})

describe('before there are claims', () => {
  it('invites the reader to analyze something without an id', () => {
    view({ id: null })
    expect(screen.getByText('Nothing analyzed yet')).toBeInTheDocument()
  })

  it('says it is loading', () => {
    load(undefined, { isPending: true })
    view()
    expect(screen.getByText('Loading analysis…')).toBeInTheDocument()
  })

  it('says why it could not load', () => {
    load(undefined, { isError: true, error: new Error('404: gone') })
    view()
    expect(screen.getByText('Could not load this analysis: 404: gone')).toBeInTheDocument()
  })

  it('shows nothing when there is no analysis and no reason', () => {
    load(undefined)
    const { container } = view()
    expect(container).toBeEmptyDOMElement()
  })

  it('says a finished analysis found no claims', () => {
    load(analysis({ claims: [] }))
    view()
    expect(screen.getByText('No claims found')).toBeInTheDocument()
  })

  it('shows why a stopped analysis stopped', () => {
    load(analysis({ status: 'error', message: 'The worker was stopped.', claims: [] }))
    view()
    expect(screen.getByRole('alert')).toHaveTextContent('The worker was stopped.')
    expect(screen.queryByText('No claims found')).not.toBeInTheDocument()
  })
})

describe('a running analysis', () => {
  it('lists answered claims as they finish and a placeholder for the rest', () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }], claims: [refuted, pendingClaim, pendingClaim, pendingClaim, pendingClaim] }))
    const { container } = view()
    expect(screen.getByText('Results so far')).toBeInTheDocument()
    expect(screen.getByText('1 of 5 claims')).toBeInTheDocument()
    expect(screen.getByText('The refuted claim.')).toBeInTheDocument()
    expect(screen.queryByText('Still being checked.')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[aria-hidden="true"].border-t')).toHaveLength(3)
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument()
  })

  it('shows fewer placeholders when fewer claims are waiting, and opens an answered row', () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }], claims: [backed, pendingClaim] }))
    const { container } = view()
    expect(container.querySelectorAll('[aria-hidden="true"].border-t')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /The backed claim/ }))
    expect(screen.getByText('supports reasoning')).toBeInTheDocument()
  })

  it('shows no list before the first claim exists', () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }], claims: [] }))
    view()
    expect(screen.queryByText('Results so far')).not.toBeInTheDocument()
    expect(screen.queryByText('No claims found')).not.toBeInTheDocument()
  })

  it('opens the page of a claim from the running list, with its section', () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }], claims: [{ ...refuted, section: undefined }] }))
    view()
    fireEvent.click(screen.getByRole('button', { name: /The refuted claim/ }))
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('Claim 1 in this paper')
    expect(screen.getByTestId('viewer')).not.toHaveAttribute('data-section')
  })

  it('keeps the section on a claim from the running list', () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }], claims: [refuted] }))
    view()
    fireEvent.click(screen.getByRole('button', { name: /The refuted claim/ }))
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-section', '3.1')
  })
})

describe('the results', () => {
  it('leads with what needs attention, then the settled claims', () => {
    view()
    expect(screen.getByRole('heading', { name: 'Needs your attention' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Settled' })).toBeInTheDocument()
    expect(screen.getByText('§3.1 Encoder · page 4')).toBeInTheDocument()
  })

  it('opens only the first claim, and J and K move the keyboard between claim rows', () => {
    view()
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-claim-toggle]')]
    expect(rows()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(rows().slice(1).every((row) => row.getAttribute('aria-expanded') === 'false')).toBe(true)

    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    fireEvent.keyDown(window, { key: 'j' })
    expect(rows()[0]).toHaveFocus()
    fireEvent.keyDown(window, { key: 'J' })
    expect(rows()[1]).toHaveFocus()
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(rows()[1]).toHaveFocus() // the last row stays put
    fireEvent.keyDown(window, { key: 'k' })
    expect(rows()[0]).toHaveFocus()
    fireEvent.keyDown(window, { key: 'k' })
    expect(rows()[0]).toHaveFocus()
    // @ts-expect-error jsdom has none; leave it missing for the next tests
    delete Element.prototype.scrollIntoView
  })

  it('moves to adjacent rows from an evidence button inside an expanded claim', () => {
    load(analysis({ claims: [refuted, { ...refuted, claim: 'Middle claim.' }, backed] }))
    view()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-claim-toggle]')]
    fireEvent.click(rows[0])
    fireEvent.click(rows[1])
    const evidence = screen.getByRole('button', { name: 'Show in paper' })

    evidence.focus()
    fireEvent.keyDown(evidence, { key: 'j' })
    expect(rows[2]).toHaveFocus()

    evidence.focus()
    fireEvent.keyDown(evidence, { key: 'k' })
    expect(document.querySelectorAll('[data-claim-toggle]')[0]).toHaveFocus()
  })

  it('leaves J and K alone with a modifier, in a text box, or with no claims to move to', () => {
    view()
    const first = document.querySelector<HTMLElement>('[data-claim-toggle]')!
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'x' })
    expect(first).not.toHaveFocus()
    const box = document.createElement('input')
    document.body.appendChild(box)
    box.focus()
    fireEvent.keyDown(box, { key: 'j' })
    expect(box).toHaveFocus()
    box.remove()
    // Without scrollIntoView (jsdom has none) the row still takes the focus.
    fireEvent.keyDown(window, { key: 'j' })
    expect(first).toHaveFocus()
  })

  it('opens the cited paper on O from inside an open claim', async () => {
    view()
    const first = document.querySelector<HTMLElement>('[data-claim-toggle]')!
    expect(first).toHaveAttribute('aria-expanded', 'true')
    first.focus()
    fireEvent.keyDown(first, { key: 'o' })
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-paper', 'cited.pdf'))
  })

  it('opens a folded claim on O, keeps focus on it and shows its cited paper', async () => {
    vi.useFakeTimers()
    try {
      const quoted = { ...backed, verdicts: [verdict('supports', { quote: 'It backs it.' })] }
      load(analysis({ claims: [refuted, quoted] }))
      view()
      const rows = () => [...document.querySelectorAll<HTMLElement>('[data-claim-toggle]')]
      expect(rows()[1]).toHaveAttribute('aria-expanded', 'false')
      rows()[1].focus()
      fireEvent.keyDown(rows()[1], { key: 'o' })
      expect(rows()[1]).toHaveAttribute('aria-expanded', 'true')
      await act(async () => {
        vi.runAllTimers()
      })
      expect(rows()[1]).toHaveFocus()
      vi.useRealTimers()
      await waitFor(() => expect(screen.getByTestId('viewer')).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })

  describe('a claim with no quoted passage', () => {
    const unquoted: Claim = { ...refuted, source: undefined, verdicts: [verdict('refutes')] }

    it('says so on O instead of staying silent, and clears the line on the next key', () => {
      load(analysis({ claims: [unquoted, backed] }))
      view()
      const first = document.querySelector<HTMLElement>('[data-claim-toggle]')!
      first.focus()
      fireEvent.keyDown(first, { key: 'o' })
      const text = 'No quoted passage to show for claim 1'
      expect(screen.getByRole('status')).toHaveTextContent(text)
      // The same words sit in the card the key was pressed on, not under the heading.
      expect(within(first.closest('[data-claim-card]') as HTMLElement).getByText(text)).toBeInTheDocument()
      expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
      fireEvent.keyDown(first, { key: 'j' })
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    })

    it('opens the claim in the paper on O when only the paper’s own sentence is there, and says so in the viewer', () => {
      load(analysis({ claims: [{ ...refuted, verdicts: [verdict('refutes')] }, backed] }))
      view()
      const first = document.querySelector<HTMLElement>('[data-claim-toggle]')!
      first.focus()
      fireEvent.keyDown(first, { key: 'o' })
      const viewer = screen.getByTestId('viewer')
      expect(viewer).toHaveAttribute('data-paper', 'mine.pdf')
      expect(screen.getByRole('status')).toHaveTextContent('No quote from a cited work for claim 1 · showing it in this paper')
      // The card keeps its own section and page line; the note goes under the viewer's label.
      const note = 'No cited work quotes this claim, so this is where it sits in the paper.'
      expect(within(viewer).getByText(note)).toBeInTheDocument()
      expect(within(first.closest('[data-claim-card]') as HTMLElement).queryByText(/No quote from a cited work/)).not.toBeInTheDocument()
      fireEvent.keyDown(first, { key: 'j' })
      expect(screen.queryByText(note)).not.toBeInTheDocument()
    })
  })

  it('stacks the heading row and drops the side-by-side tiles while the page viewer is open', () => {
    view()
    const tiles = () => screen.getAllByRole('button', { pressed: false })[0].parentElement as HTMLElement
    const heading = () => screen.getByRole('heading', { name: 'Needs your attention' }).parentElement as HTMLElement
    expect(tiles()).toHaveClass('sm:grid-flow-col')
    expect(heading()).not.toHaveClass('flex-col')
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    expect(tiles()).not.toHaveClass('sm:grid-flow-col')
    expect(tiles()).toHaveClass('flex-wrap')
    expect(heading()).toHaveClass('flex-col')
  })

  it('does nothing on O when focus is outside the claims', () => {
    view()
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(window, { key: 'o' })
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('tells the reader about the J, K and O keys', () => {
    view()
    const hint = screen.getByText((_, element) => element?.textContent === 'J and K move between claims · O shows the evidence' && element.tagName === 'P')
    expect([...hint.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['J', 'K', 'O'])
  })

  it('keeps Read the full reasoning open after a tile filter hides the card and shows it again', () => {
    const long = 'It does not hold. '.repeat(25)
    load(analysis({ claims: [{ ...refuted, verdicts: [verdict('refutes', { reasoning: long })] }, backed] }))
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Read the full reasoning' }))
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    expect(screen.queryByText('The refuted claim.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    expect(screen.getByRole('button', { name: 'Hide the full reasoning' })).toBeInTheDocument()
  })

  it('does nothing on J when no claim rows are on screen', () => {
    load(analysis({ claims: [] }))
    view()
    expect(() => fireEvent.keyDown(window, { key: 'j' })).not.toThrow()
  })

  it('says All claims, and has no Settled heading, when nothing needs attention', () => {
    load(analysis({ claims: [backed] }))
    view()
    expect(screen.getByRole('heading', { name: 'All claims' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settled' })).not.toBeInTheDocument()
    expect(screen.getByText('supports reasoning')).toBeInTheDocument()
  })

  it('has no Settled heading when every claim needs attention', () => {
    load(analysis({ claims: [refuted] }))
    view()
    expect(screen.queryByRole('heading', { name: 'Settled' })).not.toBeInTheDocument()
  })

  it('narrows to one kind from the count tiles and says so', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    expect(screen.getByRole('heading', { name: 'Source backs it' })).toBeInTheDocument()
    expect(screen.getByText(/^Showing 1 of \d+$/)).toBeInTheDocument()
    expect(screen.queryByText('The refuted claim.')).not.toBeInTheDocument()
    expect(screen.getByText('supports reasoning')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /The backed claim/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('counts only claims matching both selected filters', () => {
    load(analysis({ claims: [refuted, { ...refuted, claim: 'Other contradiction', section: '2' }] }))
    view({ section: '3.1', filter: 'refutes' })
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument()
    expect(screen.queryByText('Other contradiction')).not.toBeInTheDocument()
  })

  it('does not reopen a closed viewer after a quote lookup finishes', async () => {
    const lookup = Promise.withResolvers<object>()
    state.findInPaper.mockReturnValue(lookup.promise)
    view()
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    expect(screen.getByTestId('viewer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    await act(async () => lookup.resolve({ ...location, coverage: 1 }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('follows a filter the screen holds, and reports a picked tile to it', () => {
    const onFilter = vi.fn()
    view({ filter: 'supports', onFilter })
    expect(screen.queryByText('The refuted claim.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 Source contradicts' }))
    expect(onFilter).toHaveBeenCalledWith('refutes')
  })

  it('clears the standing filter from its × button', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    // One filter on: its own × only, no Clear all.
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the Source backs it filter' }))
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Source backs it' })).not.toBeInTheDocument()
    expect(screen.getByText('The refuted claim.')).toBeInTheDocument()
  })

  it('narrows to one section, and can show all claims again', () => {
    const onClearSection = vi.fn()
    view({ section: '2', onClearSection })
    expect(screen.getByText('Section 2 · Method')).toBeInTheDocument()
    expect(screen.queryByText('The refuted claim.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the section filter' }))
    expect(onClearSection).toHaveBeenCalledTimes(1)
  })

  it('with a section and a standing both on, one Clear all clears both', () => {
    const onClearSection = vi.fn()
    view({ section: '2', onClearSection })
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearSection).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })

  it('names the section without a clear button when the screen gives none', () => {
    view({ section: '2' })
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    expect(screen.queryByRole('button', { name: 'Clear the section filter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
  })

  it('says when no claim comes from the section, naming it plainly when the outline lost it', () => {
    view({ section: '9' })
    expect(screen.getByText('No claims come from this section.')).toBeInTheDocument()
    expect(screen.getByText('Section 9')).toBeInTheDocument()
  })

  it('shows the claim sections as plain section numbers when the outline lost them', () => {
    load(analysis({ outline: undefined }))
    view()
    expect(screen.getByText('§3.1 · page 4')).toBeInTheDocument()
  })

  it('shows the owner a dispute control on a verdict', () => {
    view()
    expect(screen.getAllByText('Checked by an AI judge, which can be wrong.').length).toBeGreaterThan(0)
  })
})

describe('the page viewer', () => {
  it('opens the paper itself from Open PDF and closes again', () => {
    const onTargetChange = vi.fn()
    const onCurrentSection = vi.fn()
    view({ onTargetChange, onCurrentSection })
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    const viewer = screen.getByTestId('viewer')
    expect(viewer).toHaveTextContent('The paper')
    expect(viewer).toHaveAttribute('data-markers', '1')
    expect(onTargetChange).toHaveBeenLastCalledWith(true)
    expect(onCurrentSection).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    expect(onTargetChange).toHaveBeenLastCalledWith(false)
    expect(onCurrentSection).toHaveBeenLastCalledWith(null)
  })

  it('reports the section of the claim whose page is open', () => {
    const onCurrentSection = vi.fn()
    view({ onCurrentSection })
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    expect(onCurrentSection).toHaveBeenLastCalledWith('3.1')
  })

  it('leads from the label of a claim page back to that claim', () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    view()
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to claim' }))
    expect(document.querySelector('[data-claim="0"] [data-claim-toggle]')).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('gives the label no link when the page is not one of a claim', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    expect(screen.queryByRole('button', { name: 'Back to claim' })).not.toBeInTheDocument()
  })

  it('keeps the page of a claim that a picked standing hides, and says so with a way back', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    fireEvent.click(screen.getByRole('button', { name: '1 Source backs it' }))
    const viewer = screen.getByTestId('viewer')
    expect(viewer).toHaveTextContent('Claim 1 is hidden by the current filter')
    fireEvent.click(within(viewer).getByRole('button', { name: 'Show all claims' }))
    expect(screen.getByText('The refuted claim.')).toBeInTheDocument()
    expect(viewer).not.toHaveTextContent('hidden by the current filter')
  })

  it('keeps the page of a claim that a picked standing still shows, with no note', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    fireEvent.click(screen.getByRole('button', { name: '1 Source contradicts' }))
    expect(screen.getByTestId('viewer')).not.toHaveTextContent('hidden by the current filter')
  })

  it('reports the section of the page when the target names none', () => {
    const onCurrentSection = vi.fn()
    load(analysis({ claims: [{ ...refuted, section: undefined }] }))
    view({ onCurrentSection })
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    expect(onCurrentSection).toHaveBeenLastCalledWith('3.1')
  })

  it('reports no section for a page of the paper with no page number', async () => {
    const onCurrentSection = vi.fn()
    load(analysis({ claims: [{ ...refuted, section: undefined, verdicts: [verdict('refutes', { quote: 'Q', source: 'mine.pdf' })] }] }))
    view({ onCurrentSection })
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(screen.getByTestId('viewer')).toBeInTheDocument())
    expect(onCurrentSection).toHaveBeenLastCalledWith(null)
  })

  it('opens a cited paper from the running list without a section', async () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }], claims: [refuted] }))
    view()
    fireEvent.click(screen.getByRole('button', { name: /The refuted claim/ }))
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-paper', 'cited.pdf'))
    expect(screen.getByTestId('viewer')).not.toHaveAttribute('data-section')
  })

  it('opens a cited paper without the analysed paper markers or a section', async () => {
    const onCurrentSection = vi.fn()
    view({ onCurrentSection })
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(screen.getByTestId('viewer')).toBeInTheDocument())
    const viewer = screen.getByTestId('viewer')
    expect(viewer).toHaveAttribute('data-paper', 'cited.pdf')
    expect(viewer).toHaveAttribute('data-markers', 'none')
    expect(onCurrentSection).toHaveBeenLastCalledWith(null)
  })

  it('does not report to a screen that did not ask', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('opens the page of a section picked in the contents, until the reader opens another', () => {
    const jump: SectionJump = { n: '2', title: 'Method', page: 3, at: Date.now() + 60_000 }
    const { again } = view({ jump })
    const viewer = screen.getByTestId('viewer')
    expect(viewer).toHaveTextContent('Section 2 · Method')
    expect(viewer).toHaveAttribute('data-section', '2')
    again({ jump: { ...jump, at: 0 } })
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('ignores a picked section when the analysis has no file to open', () => {
    load(analysis({ file: undefined }))
    view({ jump: { n: '2', title: 'Method', page: 3, at: Date.now() + 60_000 } })
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('has no Open PDF without a file', () => {
    load(analysis({ file: undefined }))
    view()
    expect(screen.queryByRole('button', { name: 'Open PDF' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open PDF' })).not.toBeInTheDocument()
  })

  it('does not open the paper on its own for a researcher', () => {
    view()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('opens the paper on load when asked, once, and not after the reader closed it', () => {
    const onTargetChange = vi.fn()
    const onCurrentSection = vi.fn()
    view({ openPaperOnLoad: true, onTargetChange, onCurrentSection })
    expect(screen.getByTestId('viewer')).toHaveTextContent('The paper')
    expect(onTargetChange).toHaveBeenCalledTimes(1)
    expect(onTargetChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('opens the paper on load without a screen to tell', () => {
    view({ openPaperOnLoad: true })
    expect(screen.getByTestId('viewer')).toBeInTheDocument()
  })
})

describe('the Teacher presentation', () => {
  it('opens the first claim in the submission, and opens another by its claim card', () => {
    load(analysis({ claims: [{ ...backed, source: location, sentence: 'Backed sentence.' }, { ...refuted, section: undefined }] }))
    view({ presentation: 'teacher', openPaperOnLoad: true })
    expect(screen.getByTestId('viewer')).toHaveTextContent('Claim 2 in this paper')
    fireEvent.click(screen.getByRole('button', { name: /The backed claim/ }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('Claim 1 in the submission')
  })

  it('closes the submission viewer, and gives a cited paper no markers', async () => {
    view({ presentation: 'teacher', openPaperOnLoad: true })
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-markers', '1')
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-paper', 'cited.pdf'))
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-markers', 'none')
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('opens the whole paper when the first claim has no location', () => {
    load(analysis({ claims: [backed] }))
    view({ presentation: 'teacher', openPaperOnLoad: true })
    expect(screen.getByTestId('viewer')).toHaveTextContent('The paper')
  })

  it('opens a claim whose standing is not a verdict without a color', () => {
    load(analysis({ claims: [{ claim: 'Unchecked one.', citations: [citation], source: location }] }))
    view({ presentation: 'teacher', openPaperOnLoad: true })
    expect(screen.getByTestId('viewer')).toHaveTextContent('Claim 1 in this paper')
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('Claim 1 in the submission')
  })

  it('shows the roster label and claim controls without a Feedback toolbar button', () => {
    const onTeacherFeedback = vi.fn()
    view({
      presentation: 'teacher',
      paperLabel: 'Ann · essay.pdf',
      onTeacherFeedback,
      renderClaimActions: (_claim, index) => <button>Review {index + 1}</button>,
    })
    expect(screen.getByText('Ann · essay.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument()
    expect(onTeacherFeedback).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /^Review/ })).toHaveLength(1) // only the open claim shows its controls
  })

  it('shows the pipeline progress only while it runs, and no header or Settled heading', () => {
    load(analysis({ status: 'running', stages: [{ stage: 'queued' }] }))
    const { unmount } = view({ presentation: 'teacher' })
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    unmount()
    load(analysis())
    view({ presentation: 'teacher' })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settled' })).not.toBeInTheDocument()
  })

  it('shows a claim without a location as a plain row', () => {
    load(analysis({ file: undefined }))
    view({ presentation: 'teacher' })
    fireEvent.click(screen.getAllByRole('button', { expanded: true })[0])
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })
})

describe('Back and Forward into an analysis', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  const toggles = () => [...document.querySelectorAll<HTMLElement>('[data-claim-toggle]')]

  it('keeps the open page and the opened cards in the history entry, and restores them on return', () => {
    window.history.replaceState(null, '', '/?analysis=a1')
    const { unmount } = view()
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    fireEvent.click(toggles()[1])
    expect(window.history.state.analysisView).toMatchObject({ id: 'a1', target: { paper: 'mine.pdf' }, parts: [['claim 1', true]] })
    unmount()

    const onTargetChange = vi.fn()
    view({ onTargetChange })
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-paper', 'mine.pdf')
    expect(onTargetChange).toHaveBeenCalledWith(true)
    expect(toggles()[1]).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(window.history.state.analysisView.target).toBeNull()
  })

  it('writes nothing once the address names another page, and ignores what another analysis saved', () => {
    window.history.replaceState({ analysisView: { id: 'other', target: { paper: 'x.pdf', label: 'X', source: null }, parts: [] } }, '', '/?analysis=b2')
    view()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    fireEvent.click(toggles()[1])
    expect(window.history.state.analysisView.id).toBe('other')
  })
})
