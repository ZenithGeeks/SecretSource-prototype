/** The labeler's Ask panel on its own: the review of a saved claim, and questions about the paper,
 * a reference, a passage, or a /command. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Run = { events: unknown[]; end: 'ok' | 'fail' | 'abort' | 'hang' }
const gateway = vi.hoisted(() => ({
  review: { events: [], end: 'ok' } as Run,
  ask: { events: [], end: 'ok' } as Run,
  asked: [] as unknown[],
  tool: 'ok' as 'ok' | 'fail' | 'abort',
  result: null as Record<string, unknown> | null,
  signals: [] as AbortSignal[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  postEvents: vi.fn(async (path: string, body: unknown, onEvent: (event: unknown) => void, signal: AbortSignal) => {
    const run = path.endsWith('/review') ? gateway.review : gateway.ask
    gateway.signals.push(signal)
    if (!path.endsWith('/review')) gateway.asked.push(body)
    for (const event of run.events) onEvent(event)
    if (run.end === 'fail') throw new Error('502: down')
    if (run.end === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (run.end === 'hang') await new Promise(() => undefined)
  }),
  request: vi.fn(async () => {
    if (gateway.tool === 'fail') throw new Error('404: gone')
    if (gateway.tool === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (gateway.result) return gateway.result
    return { title: 'Paper A', status: 'done', claims: [], standing: { backed: 0, silent: 0, contradicted: 0, unchecked: 0 } }
  }),
}))

import { request } from '../src/lib/api'
import type { Candidate, WorkClaim } from '../src/lib/labeling'
import { AskPanel, type AskedPassage } from '../src/roles/labeler/components/AskPanel'

const cand = (id: string, rank: number, reference_id = 'refB'): Candidate => ({
  cand_id: id,
  reference_id,
  reference_file: `${reference_id}.pdf`,
  rank,
  score: 1,
  page: 2,
  passage: `text of ${id}`,
})

const claim: WorkClaim = {
  claim_id: 'p#0',
  claim: 'Y is fast.',
  sentence: '',
  section: '',
  source: null,
  candidates: [cand('c1', 1), cand('c2', 2, 'refX')],
  origin: 'extracted',
}
const references = [{ reference_id: 'refB', file: 'refB.pdf', label: 'Ref B' }]

function renderPanel(over: Partial<Parameters<typeof AskPanel>[0]> = {}) {
  const props = {
    analysisId: 'a1',
    claim,
    wording: 'Y is fast.',
    references,
    reviewBlocked: null,
    onPoint: vi.fn(),
    passage: null as AskedPassage | null,
    askId: 0,
    onClearPassage: vi.fn(),
    ...over,
  }
  const view = render(<AskPanel {...props} />)
  return { props, ...view }
}

const finding = (target: unknown, tone = 'flags', text = 'Check this.') => ({ type: 'finding', target, tone, text })
const question = () => screen.getByLabelText('Question')
function ask(text: string) {
  fireEvent.change(question(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

beforeEach(() => {
  gateway.review = { events: [], end: 'ok' }
  gateway.ask = { events: [], end: 'ok' }
  gateway.asked.length = 0
  gateway.tool = 'ok'
  gateway.result = null
  gateway.signals.length = 0
  vi.mocked(request).mockClear()
})
afterEach(() => vi.useRealTimers())

describe('the review', () => {
  it('says why it cannot run yet, and keeps the button off', () => {
    renderPanel({ reviewBlocked: 'Save this claim first.' })
    expect(screen.getByText('Save this claim first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
  })

  it('says there is nothing to point out when the review finds nothing', async () => {
    gateway.review.events = [{ type: 'done', findings: 0 }]
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByText('Nothing to point out.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review again' })).toBeEnabled()
  })

  it('names what each finding is about, and points the cursor at the one the person picks', async () => {
    gateway.review.events = [
      finding({ kind: 'claim', id: 'p#0' }),
      finding({ kind: 'reference', id: 'refB' }, 'agrees'),
      finding({ kind: 'reference', id: 'unknown-ref' }, 'asks'),
      finding({ kind: 'passage', id: 'c1' }),
      finding({ kind: 'passage', id: 'c2' }),
      finding({ kind: 'passage', id: 'gone' }),
    ]
    const { props } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const items = await screen.findAllByRole('listitem')
    await waitFor(() => expect(items).toHaveLength(6))
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual([
      expect.stringContaining('The claim'),
      expect.stringContaining('Ref B'),
      expect.stringContaining('unknown-ref'),
      expect.stringContaining('Passage 1 of Ref B'),
      expect.stringContaining('Passage 2 of refX'),
      expect.stringContaining('A passage'),
    ])
    fireEvent.click(within(items[3]).getByRole('button', { name: 'Show me' }))
    expect(props.onPoint).toHaveBeenLastCalledWith({ target: { kind: 'passage', id: 'c1' }, tone: 'flags' })
  })

  it('moves the cursor on to the next finding after a pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    gateway.review.events = [finding({ kind: 'claim', id: 'p#0' }), finding({ kind: 'reference', id: 'refB' }, 'agrees')]
    const { props } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(props.onPoint).toHaveBeenLastCalledWith({ target: { kind: 'claim', id: 'p#0' }, tone: 'flags' }))
    await act(() => vi.advanceTimersByTimeAsync(1200))
    expect(props.onPoint).toHaveBeenLastCalledWith({ target: { kind: 'reference', id: 'refB' }, tone: 'agrees' })
  })

  it('shows the error the review reports', async () => {
    gateway.review.events = [{ type: 'error', message: 'The judge is down.' }]
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The judge is down.')
  })

  it('says what to do when the review request fails, and stays quiet when it was stopped', async () => {
    gateway.review.end = 'fail'
    const { unmount } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scopus did not answer.')
    unmount()

    gateway.review.end = 'abort'
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(gateway.signals).toHaveLength(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stops a review still running when the panel goes away, and when it starts again', async () => {
    gateway.review.end = 'hang'
    const { unmount } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(gateway.signals).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
    unmount()
    expect(gateway.signals[0].aborted).toBe(true)
  })

  it('aborts the earlier review when a new one starts', async () => {
    gateway.review = { events: [], end: 'ok' }
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review again' }))
    await waitFor(() => expect(gateway.signals).toHaveLength(2))
    expect(gateway.signals[0].aborted).toBe(true)
  })
})

describe('a question', () => {
  it('ignores a blank question', () => {
    renderPanel()
    fireEvent.submit(question().closest('form') as HTMLFormElement)
    expect(gateway.asked).toEqual([])
  })

  it('asks about the paper, or about one of the references the passages came from', async () => {
    renderPanel()
    ask('Which dataset?')
    await waitFor(() => expect(gateway.asked).toHaveLength(1))
    expect(gateway.asked[0]).toEqual({ question: 'Which dataset?', reference_id: '' })
    expect(screen.getByRole('option', { name: 'Ref B' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'refX' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('About'), { target: { value: 'refB' } })
    ask('And here?')
    await waitFor(() => expect(gateway.asked).toHaveLength(2))
    expect(gateway.asked[1]).toEqual({ question: 'And here?', reference_id: 'refB' })
  })

  it('says no passage answers when the answer has no statements', async () => {
    gateway.ask.events = [{ type: 'done', statements: 0 }]
    renderPanel()
    ask('Anything?')
    expect(await screen.findByText('No passage in it answers that.')).toBeInTheDocument()
  })

  it('lists each statement with the verdict the judge gave, and a summary', async () => {
    gateway.ask.events = [
      { type: 'statement', index: 0, text: 'It is fast.', source: 'a.pdf', page: 3 },
      { type: 'statement', index: 1, text: 'It is cheap.', source: 'a.pdf' },
      { type: 'statement', index: 2, text: 'It is green.', source: 'a.pdf' },
      { type: 'verdict', index: 0, verdict: 'supports', quote: 'very fast', reasoning: 'Says so.' },
      { type: 'verdict', index: 1, verdict: 'refutes', quote: '', reasoning: 'It costs a lot.' },
      { type: 'verdict', index: 9, verdict: 'supports', quote: '', reasoning: '' },
    ]
    renderPanel()
    ask('How is it?')
    expect(await screen.findByText('1 of 3 backed · 1 contradicted')).toBeInTheDocument()
    expect(screen.getByText('Page 3')).toBeInTheDocument()
    expect(screen.getByText('Backed')).toBeInTheDocument()
    expect(screen.getByText('Contradicted')).toBeInTheDocument()
    expect(screen.getByText("Can't check")).toBeInTheDocument() // the third never got a verdict
    expect(screen.getByText('“very fast”')).toBeInTheDocument()
    expect(screen.getByText('It costs a lot.')).toBeInTheDocument()
  })

  it('shows Checking while verdicts are still coming in', async () => {
    gateway.ask.events = [{ type: 'statement', index: 0, text: 'It is fast.', source: 'a.pdf' }]
    gateway.ask.end = 'hang'
    renderPanel()
    ask('How is it?')
    expect(await screen.findByText('Checking 1 of 1')).toBeInTheDocument()
    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('says Reading the paper while nothing has arrived', async () => {
    gateway.ask.end = 'hang'
    renderPanel()
    ask('Slow one')
    expect(await screen.findByText('Reading the paper…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('shows the error the answer reports, and the one a failed request gives', async () => {
    gateway.ask.events = [{ type: 'error', message: 'No index.' }]
    const { unmount } = renderPanel()
    ask('First')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not answer: No index.')
    unmount()

    gateway.ask = { events: [], end: 'fail' }
    renderPanel()
    ask('Second')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not answer: Scopus did not answer')
  })

  it('stays quiet about an answer that was stopped', async () => {
    gateway.ask.end = 'abort'
    renderPanel()
    ask('Stopped')
    await waitFor(() => expect(gateway.asked).toHaveLength(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('aborts the earlier question when another is asked', async () => {
    renderPanel()
    ask('One')
    await waitFor(() => expect(gateway.signals).toHaveLength(1))
    ask('Two')
    await waitFor(() => expect(gateway.signals).toHaveLength(2))
    expect(gateway.signals[0].aborted).toBe(true)
  })
})

describe('a question about one passage', () => {
  const passage: AskedPassage = { referenceId: 'refB', name: '#1 Ref B', page: 2, text: 'text of c1' }

  it('reads the passage with the claim as worded on screen, and can go back to the whole paper', async () => {
    gateway.ask.end = 'hang'
    const { props } = renderPanel({ passage, wording: 'Y is very fast.' })
    expect(screen.getByText('#1 Ref B · p.2')).toBeInTheDocument()
    ask('Does it back the claim?')
    await waitFor(() => expect(gateway.asked).toHaveLength(1))
    expect(gateway.asked[0]).toEqual({ question: 'Does it back the claim?', reference_id: 'refB', passage: 'text of c1', claim: 'Y is very fast.' })
    expect(screen.getByText('Reading the passage…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop asking about this passage' }))
    expect(props.onClearPassage).toHaveBeenCalled()
  })

  it('names a passage with no page by its name alone', () => {
    renderPanel({ passage: { ...passage, page: null } })
    expect(screen.getByText('#1 Ref B')).toBeInTheDocument()
  })
})

describe('a /command', () => {
  it('shows the result of a command on the open paper', async () => {
    renderPanel()
    ask('/get_analysis')
    expect(await screen.findByText('Paper A')).toBeInTheDocument()
  })

  it('adds the note a command comes with', async () => {
    gateway.result = { results: [] }
    renderPanel()
    ask('/check_text a')
    expect(await screen.findByText('No sentence long enough to check.')).toBeInTheDocument()
  })

  it('explains a command it cannot read', async () => {
    renderPanel()
    ask('/nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no /nope command.')
  })

  it('says when the command failed, and stays quiet when it was stopped', async () => {
    gateway.tool = 'fail'
    const { unmount } = renderPanel()
    ask('/get_analysis')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not answer: This paper is not available')
    unmount()

    gateway.tool = 'abort'
    renderPanel()
    ask('/get_analysis')
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
