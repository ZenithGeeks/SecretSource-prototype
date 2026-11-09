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
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 steps' }))
    expect(screen.getByText('Waiting for a free worker')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide the steps' }))
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

  it('is one line with the outcome of every source check and the time taken', () => {
    show(full, 'done')
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.getByText('3 claims')).toBeInTheDocument()
    expect(screen.getByText("4 source checks: 1 backed, 1 contradicted, 1 silent, 1 couldn't run")).toBeInTheDocument()
    expect(screen.getByText('5 min')).toBeInTheDocument()
  })

  it('says sources were not checked when the run skipped them', () => {
    show([at('extracted', { claims: 1 }), at('figures'), at('audited'), at('done')], 'done')
    expect(screen.getByText('1 claim')).toBeInTheDocument()
    expect(screen.getByText('sources not checked')).toBeInTheDocument()
  })

  it('counts checks with no outcome to list', () => {
    show([at('extracted'), at('planned', { checks: 2 }), at('done')], 'done')
    expect(screen.getByText('0 source checks')).toBeInTheDocument()
  })

  it('says Stopped for a run that ended in error', () => {
    show([at('queued'), at('error', { message: 'boom' })], 'error')
    expect(screen.getByText('Stopped')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(tile('Find the claims').querySelector('.text-refutes')).toBeInTheDocument()
  })

  it('shows a run stopped after reading as failed on the matching tile', () => {
    show([at('queued'), at('extracted', { claims: 1 }), at('error', { message: 'boom' })], 'error')
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(tile('Match citations').querySelector('.text-refutes')).toBeInTheDocument()
    expect(tile('Find the claims').querySelector('.text-supports')).toBeInTheDocument()
  })

  it('shows a stopped run that never started reading as failed on the first tile', () => {
    show([at('queued'), at('error', { message: 'boom' })], 'error')
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(tile('Read the paper').querySelector('.text-refutes')).toBeInTheDocument()
  })

  it('shows a plan whose checks never ran as in progress', () => {
    show([at('extracted'), at('planned', { checks: 2 })], 'done')
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(tile('Match citations').querySelector('.animate-spin')).toBeInTheDocument()
  })
})
