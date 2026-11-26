/** AnalysisProgress: the four tiles of a running analysis, and the one quiet line of a finished one. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnalysisProgress } from '../src/components/AnalysisProgress'
import type { Claim, Stage } from '../src/lib/api'

const NOW = 1_800_000_000
const at = (stage: Stage['stage'], extra: Partial<Stage> = {}): Stage => ({ stage, ...extra })
const claims: Claim[] = [{ claim: 'c', citations: [{ title: 'ColBERT', authors: ['Khattab'], year: '2020', doi: 'd1', arxiv: '', url: '' }] }]

function show(stages: Stage[], status: string) {
  return render(<AnalysisProgress stages={stages} claims={claims} status={status} />)
}

const tile = (label: string) => screen.getByText(label).closest('li') as HTMLElement
const bar = () => screen.getByRole('progressbar', { name: 'Analysis progress' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW * 1000)
})
afterEach(() => vi.useRealTimers())

describe('a running analysis', () => {
  it('renders nothing before the first stage', () => {
    const { container } = show([], 'running')
    expect(container).toBeEmptyDOMElement()
  })

  it('starts on reading the paper, with the rest waiting', () => {
    show([at('queued', { at: NOW - 5 })], 'running')
    expect(screen.getByText('Reading the paper')).toBeInTheDocument()
    expect(within(tile('Find the claims')).getByText('Waiting')).toBeInTheDocument()
    expect(within(tile('Match citations')).getByText('Waiting')).toBeInTheDocument()
    expect(within(tile('Weigh the evidence')).getByText('Waiting')).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(/You can leave this page/)).toBeInTheDocument()
  })

  it('moves on to finding the claims once the paper is being read', () => {
    show([at('queued'), at('extracting')], 'running')
    expect(screen.getByText('Finding the claims')).toBeInTheDocument()
    expect(tile('Read the paper').querySelector('.text-supports')).toBeInTheDocument()
  })

  it('shows the checks done out of the total, the percent, and the checks running now', () => {
    show(
      [
        at('extracted', { claims: 1 }),
        at('planned', { checks: 4, sources: 2 }),
        at('verified', { claim: 0, source: 'd1', verdict: 'supports' }),
        at('verifying', { claim: 0, source: 'd1x' }),
        at('verifying', { claim: 0, source: 'd1' }),
      ],
      'running',
    )
    expect(screen.getByText('Matching citations to the cited papers')).toBeInTheDocument()
    expect(within(tile('Find the claims')).getByText('1 claim')).toBeInTheDocument()
    expect(within(tile('Match citations')).getByText('1 of 4 found')).toBeInTheDocument()
    expect(screen.getByText('Claim 1')).toBeInTheDocument()
    expect(screen.getByText('against d1x')).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '56') // two tiles done and a quarter of the third, over 4
  })

  it('counts checks without a total for a run from before the gateway published it', () => {
    show([at('extracted', { claims: 1 }), at('verifying', { claim: 0, source: 'd1' }), at('verified', { claim: 0, source: 'd1', verdict: 'supports' })], 'running')
    expect(within(tile('Match citations')).getByText('1 check done')).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '50')
  })

  it('tells the elapsed time to the second', () => {
    show([at('queued', { at: NOW - 5 })], 'running')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(bar()).toBeInTheDocument()
  })

  it('shows every step on request', () => {
    show([at('queued'), at('extracting')], 'running')
    fireEvent.click(screen.getByRole('button', { name: 'Show the run log' }))
    expect(screen.getByText('Waiting for a free worker')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide the run log' }))
    expect(screen.queryByText('Waiting for a free worker')).not.toBeInTheDocument()
  })

  it('groups the sources that could not be checked, and lists them on request', () => {
    show(
      [
        at('extracted', { claims: 1 }),
        at('planned', { checks: 3, sources: 3 }),
        at('failed', { claim: 0, source: 'd1', reason: 'withdrawn' }),
        at('failed', { claim: 0, source: 'other', reason: 'withdrawn' }),
        at('failed', { claim: 0, source: 'third', reason: 'no-open-access' }),
      ],
      'running',
    )
    const toggle = screen.getByRole('button', { name: "3 sources couldn't be checked" })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText('withdrawn by its authors on arXiv (2)')).toBeInTheDocument()
    expect(screen.getByText('Khattab (2020). ColBERT · other')).toBeInTheDocument()
    expect(screen.getByText('no free copy published (1)')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.queryByText(/withdrawn by its authors/)).not.toBeInTheDocument()
  })

  it('says one source in the singular', () => {
    show([at('extracted'), at('planned'), at('failed', { claim: 0, source: 'x', reason: 'failed' })], 'running')
    expect(screen.getByRole('button', { name: "1 source couldn't be checked" })).toBeInTheDocument()
  })

  it('shows the figures and audit steps as the last tile', () => {
    show([at('extracted'), at('planned', { checks: 1 }), at('verifying'), at('figures', { figures: 1 })], 'running')
    expect(screen.getByText('Weighing the evidence')).toBeInTheDocument()
  })
})

describe('a finished analysis', () => {
  const full = [
    at('queued', { at: NOW - 300 }),
    at('extracted', { claims: 3 }),
    at('planned', { checks: 4, sources: 2 }),
    at('verified', { claim: 0, source: 'a', verdict: 'supports' }),
    at('verified', { claim: 0, source: 'b', verdict: 'refutes' }),
    at('verified', { claim: 1, source: 'c', verdict: 'insufficient' }),
    at('failed', { claim: 1, source: 'd', reason: 'failed' }),
    at('figures', { figures: 0 }),
    at('audited', { findings: 0 }),
    at('done', { at: NOW }),
  ]

  it('is one line with the claims, the citations checked and the time taken', () => {
    show(full, 'done')
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.getByText('3 claims')).toBeInTheDocument()
    expect(screen.getByText('4 citations checked')).toBeInTheDocument()
    expect(screen.getByText('5 min')).toBeInTheDocument()
  })

  it('says sources were not checked when the run skipped them', () => {
    show([at('extracted', { claims: 1 }), at('figures'), at('audited'), at('done')], 'done')
    expect(screen.getByText('1 claim')).toBeInTheDocument()
    expect(screen.getByText('sources not checked')).toBeInTheDocument()
  })

  it('counts checks with no outcome to list', () => {
    show([at('extracted'), at('planned', { checks: 2 }), at('done')], 'done')
    expect(screen.getByText('0 citations checked')).toBeInTheDocument()
  })

  it('says Stopped for a run that ended in error', () => {
    show([at('queued'), at('error', { message: 'boom' })], 'error')
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  it('opens a stopped run on its steps, with its lowercase "started" time, and folds it to one line', () => {
    render(<AnalysisProgress stages={[at('queued'), at('error', { message: 'boom' })]} claims={claims} status="error" when="Started 8 Nov 2026, 17:40" />)
    expect(within(tile('Read the paper')).getByText('Stopped here')).toBeInTheDocument()
    expect(screen.getByText(/· started 8 Nov 2026, 17:40/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.getByText('started 8 Nov 2026, 17:40')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  it('marks the step a run stopped at, and the bar, as a warning', () => {
    show([at('queued'), at('error', { message: 'boom' })], 'error')
    expect(tile('Read the paper').closest('li')).toHaveClass('bg-insufficient-soft')
    expect(bar().firstElementChild).toHaveClass('bg-insufficient')
  })

  it('opens the four tiles on request and folds again', () => {
    show(full, 'done')
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '100')
    expect(screen.queryByText(/You can leave this page/)).not.toBeInTheDocument()
    expect(within(tile('Match citations')).getByText('4 of 4 found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.getByRole('button', { name: /Details/ })).toBeInTheDocument()
  })

  it('shows where a stopped run got to', () => {
    show([at('queued'), at('extracting'), at('error', { message: 'boom' })], 'error')
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(tile('Find the claims').querySelector('.text-ink-muted')).toBeInTheDocument()
    // The bar stops at the one finished tile of four, and the tiles after it say they did not run.
    expect(bar()).toHaveAttribute('aria-valuenow', '25')
    expect(within(tile('Match citations')).getByText('Not run')).toBeInTheDocument()
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
  })

  it('shows a run stopped after reading as failed on the matching tile', () => {
    show([at('queued'), at('extracted', { claims: 1 }), at('error', { message: 'boom' })], 'error')
    expect(tile('Match citations').querySelector('.text-insufficient')).toBeInTheDocument()
    expect(tile('Find the claims').querySelector('.text-supports')).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '50')
  })

  it('shows a stopped run that never started reading as failed on the first tile', () => {
    show([at('queued'), at('error', { message: 'boom' })], 'error')
    expect(tile('Read the paper').querySelector('.text-insufficient')).toBeInTheDocument()
  })

  it('says Stopped here on the step a run stopped at', () => {
    show([at('queued'), at('error', { message: 'boom' })], 'error')
    expect(within(tile('Read the paper')).getByText('Stopped here')).toBeInTheDocument()
  })

  it('puts the detail of the step after Stopped here', () => {
    show([at('queued'), at('extracted', { claims: 1 }), at('planned', { checks: 2 }), at('error', { message: 'boom' })], 'error')
    expect(within(tile('Match citations')).getByText('Stopped here · 0 of 2 found')).toBeInTheDocument()
  })

  it('shows a plan whose checks never ran as in progress', () => {
    show([at('extracted'), at('planned', { checks: 2 })], 'done')
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(tile('Match citations').querySelector('.animate-spin')).toBeInTheDocument()
  })
})
