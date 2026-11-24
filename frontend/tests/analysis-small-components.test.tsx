/** The small pieces of the analysis screen: header, stage list, contents, export menu, dispute
 * form, source dialog and authorized image. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  stopAnalysis: vi.fn(),
  disputeVerdict: vi.fn(),
  getAnalysis: vi.fn(),
  downloadText: vi.fn(),
  authorized: vi.fn(),
}))

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  api: {
    stopAnalysis: gateway.stopAnalysis,
    disputeVerdict: gateway.disputeVerdict,
    getAnalysis: gateway.getAnalysis,
  },
}))
vi.mock('../src/lib/csv', () => ({ downloadText: gateway.downloadText, csvText: () => '' }))
vi.mock('../src/lib/useAuthorizedUrl', () => ({ useAuthorizedUrl: gateway.authorized }))

import { AnalysisHeader } from '../src/components/AnalysisHeader'
import { AuthorizedImage } from '../src/components/AuthorizedImage'
import { ExportMenu } from '../src/components/ExportMenu'
import { PipelineStages } from '../src/components/PipelineStages'
import { SourceDialog } from '../src/components/SourceDialog'
import { StandingKey } from '../src/components/StandingKey'
import { AnalysisContents, TableOfContents } from '../src/components/TableOfContents'
import { VerdictDispute } from '../src/components/VerdictDispute'
import type { Analysis, Claim, Stage, Verdict } from '../src/lib/api'

let client: QueryClient
function withClient(ui: ReactNode) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.clearAllMocks()
})

afterEach(() => vi.useRealTimers())

describe('AnalysisHeader', () => {
  const NOW = 1_800_000_000
  const base = (extra: Partial<Analysis> = {}): Analysis => ({
    id: 'a1', paper: 'paper.pdf', status: 'done', claims: [], stages: [], ...extra,
  })
  const renderHeader = (analysis: Analysis) => render(withClient(<AnalysisHeader analysis={analysis} />))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW * 1000)
  })

  it.each([
    [10, 'Analyzed just now'],
    [300, 'Analyzed 5 min ago'],
    [3 * 3600, 'Analyzed 3 h ago'],
    [86400, 'Analyzed 1 day ago'],
    [3 * 86400, 'Analyzed 3 days ago'],
  ])('says how long ago a finished run ended: %i s', (ago, label) => {
    renderHeader(base({ stages: [{ stage: 'done', at: NOW - ago }] }))
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('says just Analyzed for a run with no times', () => {
    renderHeader(base())
    expect(screen.getByText('Analyzed')).toBeInTheDocument()
  })

  it('shows the title and leaves the file name and claim count out of the meta line', () => {
    const claim: Claim = { claim: 'c', citations: [] }
    renderHeader(base({ title: 'A Great Paper', file: 'dir/upload.pdf', claims: [claim, claim] }))
    expect(screen.getByRole('heading', { level: 1, name: 'A Great Paper' })).toBeInTheDocument()
    expect(screen.queryByText(/upload\.pdf|claims?$/)).not.toBeInTheDocument()
  })

  it('names the first author with et al. when there are several, then the year and status', () => {
    renderHeader(base({ title: 'A Great Paper', authors: ['Ada Lovelace', 'Alan Turing'], year: '2015' }))
    expect(screen.getByText('Ada Lovelace et al. · 2015 · Analyzed')).toBeInTheDocument()
  })

  it('names a lone author as they are', () => {
    renderHeader(base({ title: 'A Great Paper', authors: ['Ada Lovelace'] }))
    expect(screen.getByText('Ada Lovelace · Analyzed')).toBeInTheDocument()
  })

  it('titles a run with nothing else by its paper id and does not repeat the id in the meta line', () => {
    renderHeader(base({ paper: '10.1000/xyz' }))
    expect(screen.getByRole('heading', { level: 1, name: '10.1000/xyz' })).toBeInTheDocument()
    expect(screen.getByText('Analyzed')).toBeInTheDocument()
  })

  it('titles a run with no title by its file name and keeps the paper id in the meta line', () => {
    renderHeader(base({ paper: '10.1000/xyz', file: 'dir/upload.pdf' }))
    expect(screen.getByRole('heading', { level: 1, name: 'upload.pdf' })).toBeInTheDocument()
    expect(screen.getByText('10.1000/xyz · Analyzed')).toBeInTheDocument()
  })

  it('takes the title from another run of the same paper in the cached list', () => {
    client.setQueryData(['analyses'], [base({ id: 'other', paper: '10.9/other', title: 'Not this one' }), base({ id: 'done', paper: '10.1000/xyz', title: 'The Real Title' })])
    renderHeader(base({ paper: '10.1000/xyz' }))
    expect(screen.getByRole('heading', { level: 1, name: 'The Real Title' })).toBeInTheDocument()
    expect(screen.getByText('10.1000/xyz · Analyzed')).toBeInTheDocument()
  })

  it('borrows the authors and year of the finished run of the same paper, and leaves the paper id out', () => {
    client.setQueryData(['analyses'], [base({ id: 'done', paper: '10.1000/xyz', title: 'The Real Title', authors: ['Ada Lovelace', 'Alan Turing'], year: '2015' })])
    renderHeader(base({ status: 'error', paper: '10.1000/xyz' }))
    expect(screen.getByText('Ada Lovelace et al. · 2015')).toBeInTheDocument()
  })

  it('does not borrow authors from a run with another title', () => {
    client.setQueryData(['analyses'], [base({ id: 'other', paper: '10.9/other', title: 'Not this one', authors: ['Grace Hopper'], year: '1952' })])
    renderHeader(base({ status: 'error', paper: '10.1000/xyz', file: 'dir/upload.pdf' }))
    expect(screen.getByText('10.1000/xyz')).toBeInTheDocument()
    expect(screen.queryByText(/Grace Hopper/)).not.toBeInTheDocument()
  })

  it('keeps its own authors when the list holds a run with the same title', () => {
    client.setQueryData(['analyses'], [base({ id: 'other', paper: '10.9/other', title: 'A Great Paper', authors: ['Grace Hopper'], year: '1952' })])
    renderHeader(base({ title: 'A Great Paper', authors: ['Ada Lovelace'], year: '2015' }))
    expect(screen.getByText('Ada Lovelace · 2015 · Analyzed')).toBeInTheDocument()
  })

  it('leaves the status out for a run that ended in error and shows no stop button', () => {
    renderHeader(base({ status: 'error', title: 'A Great Paper' }))
    expect(screen.queryByText(/Analy[sz]/)).not.toBeInTheDocument()
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('shows the elapsed time of a running analysis as it ticks, with a stop button', () => {
    renderHeader(base({ status: 'running', stages: [{ stage: 'queued', at: NOW - 30 }] }))
    expect(screen.getByText('Analyzing · 30 s')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Analyzing · 35 s')).toBeInTheDocument()
    expect(screen.queryByText(/claims?$/)).not.toBeInTheDocument()
  })

  it('shows Analyzing before the first stage has a time', () => {
    renderHeader(base({ status: 'running' }))
    expect(screen.getByText('Analyzing')).toBeInTheDocument()
  })

  it('stops the run and waits for the stream to say it ended', async () => {
    gateway.stopAnalysis.mockResolvedValue({ id: 'a1', status: 'stopping' })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHeader(base({ status: 'running' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByRole('button', { name: 'Stopping…' })).toBeDisabled()
    expect(gateway.stopAnalysis).toHaveBeenCalledWith('a1')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analysis', 'a1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analyses'] })
  })

  it('shows why stopping failed and lets the reader try again', async () => {
    gateway.stopAnalysis.mockRejectedValue(new Error('500: worker busy'))
    renderHeader(base({ status: 'running' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('500: worker busy')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })
  describe('the Help button', () => {
    const claim: Claim = { claim: 'c', citations: [] }
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView

    beforeEach(() => {
      scrollIntoView.mockClear()
      Element.prototype.scrollIntoView = scrollIntoView
    })
    afterEach(() => {
      Element.prototype.scrollIntoView = original
    })

    it('shows on a finished analysis with claims', () => {
      renderHeader(base({ claims: [claim] }))
      expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
    })

    it('is left out while the analysis runs', () => {
      renderHeader(base({ status: 'running', claims: [claim] }))
      expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
    })

    it('is left out when a finished analysis has no claims', () => {
      renderHeader(base())
      expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
    })

    it('opens the key under the tiles, scrolls to it and focuses its summary', () => {
      render(
        withClient(
          <>
            <AnalysisHeader analysis={base({ claims: [claim] })} />
            <StandingKey />
          </>,
        ),
      )
      const key = screen.getByText('What do these mean?').closest('details')!
      expect(key.open).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: 'Help' }))
      expect(key.open).toBe(true)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
      expect(screen.getByText('What do these mean?')).toHaveFocus()
    })

    it('does nothing when the page has no key to open', () => {
      renderHeader(base({ claims: [claim] }))
      fireEvent.click(screen.getByRole('button', { name: 'Help' }))
      expect(scrollIntoView).not.toHaveBeenCalled()
    })
  })
})

describe('PipelineStages', () => {
  const stage = (name: Stage['stage'], extra: Partial<Stage> = {}): Stage => ({ stage: name, ...extra })

  it('renders nothing without stages', () => {
    const { container } = render(<PipelineStages stages={[]} running={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    [stage('queued'), 'Waiting for a free worker'],
    [stage('queued', { message: 'Position 2' }), 'Position 2'],
    [stage('extracting'), 'Reading the paper'],
    [stage('extracting', { message: 'Page 3' }), 'Page 3'],
    [stage('extracted', { claims: 5 }), 'Found 5 claims'],
    [stage('extracted', { claims: 5, extracted: 9, windows: 3 }), 'Found 5 claims of 9, the ones a reader can follow furthest across 3 parts of the paper'],
    [stage('extracted', { claims: 5, extracted: 5, windows: 1 }), 'Found 5 claims'],
    [stage('extracted'), 'Found undefined claims'],
    [stage('verifying', { claim: 1, source: 'doi:1' }), 'Checking claim 2 against doi:1'],
    [stage('verifying', { source: 'doi:1' }), 'Checking claim 1 against doi:1'],
    [stage('verified', { claim: 0, verdict: 'supports' }), 'Claim 1: supports'],
    [stage('verified', { verdict: 'refutes' }), 'Claim 1: refutes'],
    [stage('failed', { claim: 2, source: 's', reason: 'withdrawn' }), 'Claim 3: could not check s — withdrawn by its authors on arXiv'],
    [stage('failed', { source: 's' }), 'Claim 1: could not check s — checking it failed'],
    [stage('planned', { checks: 4, sources: 1 }), 'Planned 4 checks against 1 cited work'],
    [stage('planned', { checks: 4, sources: 2 }), 'Planned 4 checks against 2 cited works'],
    [stage('figures', { figures: 3 }), 'Found 3 numbered figures in the paper'],
    [stage('figures'), 'Found no numbered figures in the paper'],
    [stage('audited', { findings: 2 }), 'Checked the results: 2 to look at'],
    [stage('audited'), 'Checked the results: nothing to flag'],
    [stage('done'), 'Finished'],
    [stage('rechecking'), 'Checking claims again against the uploaded PDF'],
    [stage('rechecked'), 'Checked the claims again against the uploaded PDF'],
    [stage('recheck-failed'), 'Checking the uploaded PDF failed'],
    [stage('recheck-failed', { message: 'interrupted by a restart' }), 'Checking the uploaded PDF failed: interrupted by a restart'],
    [stage('error'), 'Failed'],
    [stage('error', { message: 'out of memory' }), 'out of memory'],
  ])('describes %j', (one, text) => {
    render(<PipelineStages stages={[one]} running={false} />)
    expect(screen.getByRole('listitem')).toHaveTextContent(text)
  })

  it('shows the name of a stage this build does not know', () => {
    render(<PipelineStages stages={[stage('rebuilt' as never)]} running={false} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('rebuilt')
  })

  it('marks only the last line of a running run as busy', () => {
    const { container } = render(<PipelineStages stages={[stage('queued'), stage('extracting')]} running />)
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
  })

  it('does not tick a failure or an audit with findings', () => {
    const stages = [stage('failed', { source: 's' }), stage('audited', { findings: 1 }), stage('audited'), stage('error')]
    const { container } = render(<PipelineStages stages={stages} running={false} />)
    expect(container.querySelectorAll('.text-insufficient')).toHaveLength(2)
    expect(container.querySelectorAll('.text-supports')).toHaveLength(1)
    expect(container.querySelectorAll('.text-refutes')).toHaveLength(2) // the icon and the message
  })

  describe('a finished run with many steps', () => {
    const many = Array.from({ length: 12 }, (_, i) => stage('verified', { claim: i, verdict: 'supports' }))

    it('folds to the last three until asked', () => {
      render(<PipelineStages stages={many} running={false} />)
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      expect(screen.getByText('Claim 12: supports')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Show all 12 steps' }))
      expect(screen.getAllByRole('listitem')).toHaveLength(12)
      expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
    })

    it('shows every step while running or when told not to fold', () => {
      const { rerender } = render(<PipelineStages stages={many} running />)
      expect(screen.getAllByRole('listitem')).toHaveLength(12)
      rerender(<PipelineStages stages={many} running={false} fold={false} />)
      expect(screen.getAllByRole('listitem')).toHaveLength(12)
    })
  })
})

describe('TableOfContents', () => {
  const outline = [
    { n: '1', title: 'Introduction', page: 1, y: 0 },
    { n: '2', title: 'Method', page: 3, y: 0 },
    { n: '2.1', title: 'Encoder', page: 4, y: 0 },
  ]
  const verdict = (kind: Verdict['verdict']): Verdict => ({
    verdict: kind, quote: '', reasoning: '', source: 's', evidence: [],
  })
  const claims: Claim[] = [
    { claim: 'a', citations: [], section: '1', verdicts: [verdict('refutes')] },
    { claim: 'b', citations: [], section: '2.1' },
    { claim: 'c', citations: [], section: '2.1' },
  ]

  it('lists the sections with their claim counts and page, and marks the open one', () => {
    render(<TableOfContents outline={outline} claims={claims} current="2.1" onPick={() => {}} />)
    const encoder = screen.getByRole('button', { name: /Encoder/ })
    expect(encoder).toHaveAttribute('aria-current', 'location')
    expect(encoder).toHaveAttribute('title', '2.1 Encoder, page 4 · 2 claims')
    expect(encoder).toHaveAccessibleName('2.1 Encoder, 2 claims')
    expect(screen.getByRole('button', { name: /Method/ })).not.toHaveAttribute('aria-current')
  })

  it('says how many claims of a section a source contradicts, with a dot', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} onPick={() => {}} />)
    const introduction = screen.getByRole('button', { name: /Introduction/ })
    expect(introduction).toHaveAttribute('title', '1 Introduction, page 1 · 1 claim, 1 contradicted')
    expect(introduction.querySelector('.bg-refutes')?.closest('[aria-hidden]')).toBeInTheDocument()
  })

  it('counts only the claims of the filtered standing', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} filter="refutes" onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /Introduction/ })).toHaveAttribute('title', '1 Introduction, page 1 · 1 claim, 1 contradicted')
    expect(screen.getByRole('button', { name: /Method/ })).toHaveAttribute('title', '2 Method, page 3')
  })

  it('mutes the sections and subsections with none of the filtered standing, and keeps them listed', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} filter="refutes" onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /Introduction/ })).not.toHaveClass('text-ink-muted')
    expect(screen.getByRole('button', { name: /Method/ })).toHaveClass('text-ink-muted')
    expect(screen.getByRole('button', { name: /Encoder/ })).toHaveClass('text-ink-muted')
  })

  it('mutes nothing without a filter', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /Method/ })).not.toHaveClass('text-ink-muted')
  })

  it('is one Tab stop, on the marked section', () => {
    render(<TableOfContents outline={outline} claims={claims} current="2" onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /Method/ })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: /Introduction/ })).toHaveAttribute('tabindex', '-1')
  })

  it('puts the first section on the Tab stop when none is marked', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /Introduction/ })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: /Method/ })).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus to the next section on ArrowDown', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} onPick={() => {}} />)
    screen.getByRole('button', { name: /Introduction/ }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: /Introduction/ }), { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: /Method/ })).toHaveFocus()
  })

  it('names each section once, with its counts in words and not the digits drawn for them', () => {
    render(<TableOfContents outline={outline} claims={claims} current={null} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /Introduction/ })).toHaveAccessibleName('1 Introduction, 1 claim, 1 contradicted')
    expect(screen.getByRole('button', { name: /Encoder/ })).toHaveAccessibleName('2.1 Encoder, 2 claims')
    expect(screen.getByRole('button', { name: /Method/ })).toHaveAccessibleName('2 Method')
  })

  it('hands the picked row to the caller', () => {
    const onPick = vi.fn()
    render(<TableOfContents outline={outline} claims={claims} current={null} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /Method/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ n: '2', title: 'Method' }))
  })

  it('renders nothing for a paper without sections', () => {
    const { container } = render(<TableOfContents outline={[]} claims={[]} current={null} onPick={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reads the contents of an analysis from the gateway', async () => {
    gateway.getAnalysis.mockResolvedValue({ id: 'a1', paper: 'p', status: 'done', claims, outline, stages: [] })
    render(withClient(<AnalysisContents id="a1" current="1" onPick={() => {}} />))
    expect(await screen.findByRole('navigation', { name: 'Contents of this paper' })).toBeInTheDocument()
  })

  it('passes the claim filter on to the contents', async () => {
    gateway.getAnalysis.mockResolvedValue({ id: 'a1', paper: 'p', status: 'done', claims, outline, stages: [] })
    render(withClient(<AnalysisContents id="a1" current={null} filter="refutes" onPick={() => {}} />))
    expect(await screen.findByRole('button', { name: /Introduction/ })).toHaveAttribute('title', expect.stringContaining('1 claim, 1 contradicted'))
    expect(screen.getByRole('button', { name: /Method/ })).toHaveAttribute('title', '2 Method, page 3')
  })

  it('shows no contents for an analysis without an outline', async () => {
    gateway.getAnalysis.mockResolvedValue({ id: 'a1', paper: 'p', status: 'done', claims, stages: [] })
    const { container } = render(withClient(<AnalysisContents id="a1" current={null} onPick={() => {}} />))
    await waitFor(() => expect(gateway.getAnalysis).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ExportMenu', () => {
  const claims: Claim[] = [{ claim: 'A claim.', citations: [] }]
  const open = () => fireEvent.click(screen.getByRole('button', { name: /Export/ }))

  it('copies the claims as markdown and says so for a moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    render(<ExportMenu claims={claims} paper="p.pdf" />)
    open()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as markdown' }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('# Claims in p.pdf'))
    expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument()
  })

  it('downloads the claims as CSV', () => {
    render(<ExportMenu claims={claims} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download CSV' }))
    expect(gateway.downloadText).toHaveBeenCalledWith('claims.csv', expect.any(String), 'text/csv;charset=utf-8')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and on a click outside, but not on other keys or clicks inside', () => {
    render(<ExportMenu claims={claims} />)
    open()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // Escape is used up by the menu, so a page viewer behind it stays open, and focus goes back.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      screen.getAllByRole('menuitem')[0].dispatchEvent(escape)
    })
    expect(escape.defaultPrevented).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export/ })).toHaveFocus()
    open()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('toggles from its button', () => {
    render(<ExportMenu claims={claims} />)
    open()
    expect(screen.getByRole('button', { name: /Export/ })).toHaveAttribute('aria-expanded', 'true')
    open()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('VerdictDispute', () => {
  const verdict: Verdict = { verdict: 'supports', quote: '', reasoning: '', source: 'src.pdf', evidence: [] }
  const dispute = { claim: 0, source: 'src.pdf', note: 'wrong page', at: 1 }
  const renderDispute = (extra: { dispute?: typeof dispute } = {}) =>
    render(withClient(<VerdictDispute analysisId="a1" claimIndex={0} verdict={verdict} {...extra} />))

  it('says an AI judge made the verdict and offers to disagree', () => {
    renderDispute()
    expect(screen.getByText('Checked by an AI judge, which can be wrong.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disagree?' })).toBeInTheDocument()
  })

  it('shows the owner their earlier note, or a plain full stop without one', () => {
    renderDispute({ dispute })
    expect(screen.getByText('You disagreed: “wrong page”')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('shows a dispute without a note', () => {
    renderDispute({ dispute: { ...dispute, note: '' } })
    expect(screen.getByText('You disagreed.')).toBeInTheDocument()
  })

  it('sends the note and refreshes the analysis', async () => {
    gateway.disputeVerdict.mockResolvedValue(dispute)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderDispute()
    fireEvent.click(screen.getByRole('button', { name: 'Disagree?' }))
    fireEvent.change(screen.getByLabelText(/What did the judge get wrong/), { target: { value: 'see table 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(gateway.disputeVerdict).toHaveBeenCalledWith('a1', 0, 'src.pdf', 'see table 2'))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analysis', 'a1'] }))
    expect(await screen.findByRole('button', { name: 'Disagree?' })).toBeInTheDocument()
  })

  it('goes back without sending on Cancel', () => {
    renderDispute()
    fireEvent.click(screen.getByRole('button', { name: 'Disagree?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Disagree?' })).toBeInTheDocument()
    expect(gateway.disputeVerdict).not.toHaveBeenCalled()
  })

  it('shows why sending failed', async () => {
    gateway.disputeVerdict.mockRejectedValue(new Error('403: not yours'))
    renderDispute({ dispute })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText(/What did the judge get wrong/)).toHaveValue('wrong page')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('403: not yours')
  })
})

describe('SourceDialog', () => {
  it('takes focus and gives it back to the opener when it closes', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<SourceDialog label="Source">content</SourceDialog>)
    expect(screen.getByRole('dialog', { name: 'Source' })).toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('has nothing to give focus back to when nothing was focused', () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null)
    const { unmount } = render(<SourceDialog label="Source">content</SourceDialog>)
    expect(() => unmount()).not.toThrow()
    vi.restoreAllMocks()
  })
})

describe('AuthorizedImage', () => {
  it('shows the image once it is loaded', () => {
    gateway.authorized.mockReturnValue({ url: 'blob:img', failed: false })
    render(<AuthorizedImage src="/api/f.png" alt="Figure 1" className="max-h-10" />)
    expect(screen.getByRole('img', { name: 'Figure 1' })).toHaveAttribute('src', 'blob:img')
  })

  it('shows a placeholder while it loads', () => {
    gateway.authorized.mockReturnValue({ failed: false })
    const { container } = render(<AuthorizedImage src="/api/f.png" alt="Figure 1" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('falls back to the caption text when the image failed', () => {
    gateway.authorized.mockReturnValue({ failed: true })
    render(<AuthorizedImage src="/api/f.png" alt="Figure 1: the caption" />)
    expect(screen.getByText('Figure 1: the caption')).toHaveStyle({ maxHeight: 'none' })
  })
})
