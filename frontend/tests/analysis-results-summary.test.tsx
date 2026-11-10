/** ResultsSummary: the researcher's headline, bar and count tiles, plus the Teacher's review counts. */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({ downloadText: vi.fn(), pdf: { url: undefined as string | undefined, failed: false } }))

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/lib/csv', () => ({ downloadText: gateway.downloadText, csvText: () => '' }))
vi.mock('../src/lib/useAuthorizedUrl', () => ({ useAuthorizedUrl: vi.fn(() => gateway.pdf) }))

import { ResultsSummary } from '../src/components/ResultsSummary'
import type { Claim, Verdict } from '../src/lib/api'
import type { Standing } from '../src/lib/claims'
import { countsOf, ranked } from '../src/lib/claims'
import { useAuthorizedUrl } from '../src/lib/useAuthorizedUrl'

const verdict = (kind: Verdict['verdict']): Verdict => ({ verdict: kind, quote: '', reasoning: '', source: 's', evidence: [] })
const citation = { title: 't', authors: [], year: '', doi: 'd', arxiv: '', url: '' }

const claimWith = (standing: Standing): Claim => {
  switch (standing) {
    case 'refutes':
      return { claim: standing, citations: [citation], verdicts: [verdict('refutes')] }
    case 'insufficient':
      return { claim: standing, citations: [citation], verdicts: [verdict('insufficient')] }
    case 'supports':
      return { claim: standing, citations: [citation], verdicts: [verdict('supports')] }
    case 'unchecked':
      return { claim: standing, citations: [citation] }
    case 'named':
      return { claim: standing, citations: [citation], named: ['d'] }
    case 'uncited':
      return { claim: standing, citations: [] }
  }
}

function summary(kinds: Standing[], props: Partial<React.ComponentProps<typeof ResultsSummary>> = {}) {
  const claims = kinds.map(claimWith)
  const standings = ranked(claims)
  const onFilter = vi.fn()
  const view = render(
    <ResultsSummary
      claims={claims}
      standings={standings}
      counts={countsOf(standings)}
      filter={null}
      onFilter={onFilter}
      paper="mine.pdf"
      {...props}
    />,
  )
  return { onFilter, ...view }
}

beforeEach(() => {
  vi.clearAllMocks()
  gateway.pdf = { url: undefined, failed: false }
})
afterEach(() => vi.useRealTimers())

describe('the researcher summary', () => {
  it.each([
    [['refutes'], '1 claim is contradicted by a work they cite'],
    [['refutes', 'refutes', 'supports'], '2 claims are contradicted by a work they cite'],
    [['insufficient'], '1 claim is not settled by the works they cite'],
    [['insufficient', 'insufficient'], '2 claims are not settled by the works they cite'],
    [['unchecked'], '1 claim could not be checked'],
    [['unchecked', 'unchecked'], '2 claims could not be checked'],
    [['named', 'uncited'], 'No claim cites a work that could be checked against it'],
    [['supports'], 'Every checked citation says what the paper says it does'],
  ] as [Standing[], string][])('headlines %j', (kinds, text) => {
    summary(kinds)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('counts each kind the design shows, and names and uncited ones only when present', () => {
    summary(['refutes', 'supports', 'supports'])
    expect(screen.getByRole('button', { name: '1 contradicts' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '2 back it' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '0 silent' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /no citation/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName('1 contradicts, 2 back it')
  })

  it('adds tiles for named and uncited claims when the paper has them', () => {
    summary(['named', 'uncited', 'supports'])
    expect(screen.getByRole('button', { name: '1 names what it uses' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 no citation' })).toBeInTheDocument()
  })

  it('filters by a tile, and clears the filter when the active tile is picked again', () => {
    const { onFilter, rerender } = summary(['refutes', 'supports'])
    fireEvent.click(screen.getByRole('button', { name: '1 contradicts' }))
    expect(onFilter).toHaveBeenLastCalledWith('refutes')
    const claims = [claimWith('refutes')]
    const standings = ranked(claims)
    rerender(
      <ResultsSummary claims={claims} standings={standings} counts={countsOf(standings)} filter="refutes" onFilter={onFilter} paper="mine.pdf" />,
    )
    const active = screen.getByRole('button', { name: '1 contradicts' })
    expect(active).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(active)
    expect(onFilter).toHaveBeenLastCalledWith(null)
  })

  it('opens the paper in the viewer from Open PDF', () => {
    const onOpenPaper = vi.fn()
    summary(['supports'], { onOpenPaper })
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))
    expect(onOpenPaper).toHaveBeenCalledTimes(1)
    expect(useAuthorizedUrl).toHaveBeenLastCalledWith(undefined)
  })

  it('links to the file with the user token when there is no viewer', () => {
    gateway.pdf = { url: 'blob:pdf', failed: false }
    summary(['supports'])
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:pdf')
    expect(useAuthorizedUrl).toHaveBeenLastCalledWith('/api/papers/mine.pdf')
  })

  it('has no Open PDF without a paper', () => {
    summary(['supports'], { paper: undefined })
    expect(screen.queryByRole('button', { name: 'Open PDF' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open PDF' })).not.toBeInTheDocument()
    expect(useAuthorizedUrl).toHaveBeenLastCalledWith(undefined)
  })

  it('puts the actions in the shell toolbar when there is one', () => {
    summary(['supports'], { actionsInToolbar: true })
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument()
  })

  it('keeps the actions above the summary otherwise', () => {
    summary(['supports'])
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument()
  })
})

describe('the Teacher summary', () => {
  const teacher = (kinds: Standing[], props: Partial<React.ComponentProps<typeof ResultsSummary>> = {}) =>
    summary(kinds, { teacherMode: true, ...props })

  it('names the document and counts the claims', () => {
    teacher(['refutes', 'supports'], { paperLabel: 'Ann · essay.pdf' })
    expect(screen.getByText('Ann · essay.pdf')).toBeInTheDocument()
    expect(screen.getByText('2 claims')).toBeInTheDocument()
  })

  it('falls back to the paper name, then to This paper', () => {
    const { unmount } = teacher(['supports'])
    expect(screen.getByText('mine.pdf')).toBeInTheDocument()
    unmount()
    teacher(['supports'], { paper: undefined })
    expect(screen.getByText('This paper')).toBeInTheDocument()
  })

  it('says which kind of claim it is showing', () => {
    teacher(['refutes', 'supports'], { filter: 'refutes' })
    expect(screen.getByText(/showing 1 source contradicts/)).toBeInTheDocument()
  })

  it('filters by the count of each kind, and clears when the active one is picked again', () => {
    const { onFilter } = teacher(['refutes', 'supports'])
    expect(screen.queryByRole('button', { name: /silent/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /source contradicts/ }))
    expect(onFilter).toHaveBeenLastCalledWith('refutes')
  })

  it('clears the filter from the active count', () => {
    const { onFilter } = teacher(['refutes', 'supports'], { filter: 'supports' })
    const active = screen.getByRole('button', { name: /source backs it/ })
    expect(active).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(active)
    expect(onFilter).toHaveBeenLastCalledWith(null)
  })

  it('keeps PDF, Feedback and export actions out of the Teacher summary', () => {
    const onOpenPaper = vi.fn()
    const onTeacherFeedback = vi.fn()
    teacher(['supports'], { onOpenPaper, onTeacherFeedback })
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument()
    expect(onOpenPaper).not.toHaveBeenCalled()
    expect(onTeacherFeedback).not.toHaveBeenCalled()
  })
})
