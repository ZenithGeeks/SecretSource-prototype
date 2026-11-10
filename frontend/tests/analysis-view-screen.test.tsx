/** AnalysisView: loading and failure, a running analysis, the results list with its filters and
 * sections, and the page viewer opened from a claim, the contents or the paper itself. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    markers,
  }: {
    target: { paper: string; label: string; section?: string; page?: number }
    onClose: () => void
    markers?: unknown[]
  }) => (
    <div data-testid="viewer" data-paper={target.paper} data-section={target.section} data-markers={markers?.length ?? 'none'}>
      {target.label}
      <button onClick={onClose}>Close viewer</button>
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

  it('says All claims, and has no Settled heading, when nothing needs attention', () => {
    load(analysis({ claims: [backed] }))
    view()
    expect(screen.getByRole('heading', { name: 'All claims' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settled' })).not.toBeInTheDocument()
  })

  it('has no Settled heading when every claim needs attention', () => {
    load(analysis({ claims: [refuted] }))
    view()
    expect(screen.queryByRole('heading', { name: 'Settled' })).not.toBeInTheDocument()
  })

  it('narrows to one kind from the count tiles and says so', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '1 backs it' }))
    expect(screen.getByText('Showing 1 backs it')).toBeInTheDocument()
    expect(screen.queryByText('The refuted claim.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /The backed claim/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 backs it' }))
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })

  it('narrows to one section, and can show all claims again', () => {
    const onClearSection = vi.fn()
    view({ section: '2', onClearSection })
    expect(screen.getByText('Section 2 · Method')).toBeInTheDocument()
    expect(screen.queryByText('The refuted claim.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all claims' }))
    expect(onClearSection).toHaveBeenCalledTimes(1)
  })

  it('names the section without a clear button when the screen gives none', () => {
    view({ section: '2' })
    expect(screen.queryByRole('button', { name: 'Show all claims' })).not.toBeInTheDocument()
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

  it('shows the roster label, the feedback button and the controls it is given', () => {
    const onTeacherFeedback = vi.fn()
    view({
      presentation: 'teacher',
      paperLabel: 'Ann · essay.pdf',
      onTeacherFeedback,
      renderClaimActions: (_claim, index) => <button>Review {index + 1}</button>,
    })
    expect(screen.getByText('Ann · essay.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(onTeacherFeedback).toHaveBeenCalledTimes(1)
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
