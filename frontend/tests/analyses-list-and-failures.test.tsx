/** The Analyses list with its search, a failed run's message and retry, and deleting from the
 * sidebar with a few seconds to undo. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toasts = vi.hoisted(() => ({
  shown: [] as { text: string; undo?: () => void }[],
  errors: [] as string[],
  dismiss: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(
    (text: string, options?: { action?: { onClick: () => void } }) => {
      toasts.shown.push({ text, undo: options?.action?.onClick })
    },
    { error: (text: string) => toasts.errors.push(text), dismiss: toasts.dismiss },
  ),
}))

const gateway = vi.hoisted(() => ({
  startAnalysis: vi.fn(),
  deleteAnalysis: vi.fn(),
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  api: gateway,
}))

import { NewAnalysis } from '../src/components/NewAnalysis'
import { FailedRun } from '../src/components/FailedRun'
import { HistoryList, UNDO_DELETE_MS } from '../src/components/HistoryList'
import type { Analysis } from '../src/lib/api'
import { OFFLINE_REASON } from '../src/lib/features'
import { AnalysisList } from '../src/roles/researcher/components/AnalysisList'

const analysis = (fields: Partial<Analysis>): Analysis =>
  ({ id: 'a1', paper: '10.1/x', status: 'done', claims: [], stages: [], ...fields }) as Analysis

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

beforeEach(() => {
  toasts.dismiss.mockClear()
  toasts.shown = []
  toasts.errors = []
  // Picking a standing writes it to the address, so each test starts from a clean one.
  window.history.replaceState(null, '', '/')
  gateway.startAnalysis.mockReset()
  gateway.deleteAnalysis.mockReset().mockResolvedValue({ deleted: '' })
})

/** Opens the "Has a claim" filter and ticks one standing. */
function pickStanding(label: string) {
  const trigger = screen.getByRole('button', { name: /^Has a claim/ })
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${label}`) }))
}

describe('the Analyses list', () => {
  const claim = { claim: 'c', citations: [], verdicts: [{ verdict: 'refutes' }] }
  const list = [
    analysis({ id: 'a1', title: 'Dense retrieval', claims: [claim, claim] as Analysis['claims'] }),
    analysis({ id: 'a2', paper: '10.2/running', status: 'running' }),
    analysis({ id: 'a3', paper: '10.3/broke', status: 'error' }),
    analysis({ id: 'a4', paper: '10.4/empty' }),
  ]

  it('lists every analysis with its state, and opens one', () => {
    const onOpen = vi.fn()
    wrap(<AnalysisList analyses={list} onOpen={onOpen} />)
    expect(screen.getByText('2 claims')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('No claims')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dense retrieval/ }))
    expect(onOpen).toHaveBeenCalledWith('a1')
  })

  it('narrows to what the search matches, by title or paper id, and says when nothing does', () => {
    wrap(<AnalysisList analyses={list} onOpen={vi.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'Search your analyses' })
    fireEvent.change(search, { target: { value: 'DENSE' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1 of 4 analyses')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: '10.3' } })
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(search, { target: { value: ' nothing ' } })
    expect(screen.getByText(/^No analysis matches “nothing”/)).toBeInTheDocument()
  })

  it('lists a paper once and folds its other runs under it', () => {
    const runs = [
      analysis({ id: 'new', title: 'Dense retrieval' }),
      analysis({ id: 'old', title: 'Dense retrieval' }),
      analysis({ id: 'broke', paper: '10.3/broke', status: 'error' }),
    ]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const earlier = screen.getByText('1 earlier run').closest('details')
    expect(earlier).not.toHaveAttribute('open')
    expect(within(earlier as HTMLElement).getAllByRole('listitem')).toHaveLength(1)
  })

  it('counts several earlier runs in the plural', () => {
    const runs = [analysis({ id: 'a', title: 'Paper' }), analysis({ id: 'b', title: 'Paper' }), analysis({ id: 'c', title: 'Paper' })]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    expect(screen.getByText('2 earlier runs')).toBeInTheDocument()
  })

  it('names an earlier run by the date it ran and its claim count, and opens it', () => {
    const onOpen = vi.fn()
    const runs = [
      analysis({ id: 'new', title: 'Paper', started: '2026-11-12T14:05:00' }),
      analysis({ id: 'old', title: 'Paper', started: '2026-11-10T09:30:00', claims: [{ claim: 'c', citations: [], verdicts: [] }] as unknown as Analysis['claims'] }),
    ]
    wrap(<AnalysisList analyses={runs} onOpen={onOpen} />)
    const date = new Date('2026-11-10T09:30:00').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Ran ${date} · 1 claim`) }))
    expect(onOpen).toHaveBeenCalledWith('old')
  })

  it('falls back to the paper name when a run has no usable date and is not finished', () => {
    const runs = [
      analysis({ id: 'new', title: 'Paper' }),
      analysis({ id: 'bad', title: 'Paper', status: 'error', started: 'not a date' }),
    ]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    const earlier = screen.getByText('1 earlier run').closest('details') as HTMLElement
    expect(within(earlier).getByRole('button', { name: /^Paper/ })).toBeInTheDocument()
  })

  it('shows the date under the title of a run that has one, and keeps a stopped run in the list', () => {
    const run = analysis({ id: 'x', title: 'Paper', status: 'error', started: '2026-11-12T14:05:00' })
    wrap(<AnalysisList analyses={[run]} onOpen={vi.fn()} />)
    const date = new Date('2026-11-12T14:05:00').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    expect(screen.getByText(`Started ${date}`)).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.queryByText(/earlier run/)).not.toBeInTheDocument()
  })

  it('shows a finished run by when it ended, with its claim count', () => {
    const run = analysis({ id: 'x', title: 'Paper', completed: '2026-11-12T14:35:00', claims: [claim] as Analysis['claims'] })
    wrap(<AnalysisList analyses={[run]} onOpen={vi.fn()} />)
    const date = new Date('2026-11-12T14:35:00').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    expect(screen.getByText(`Finished ${date} · 1 claim`)).toBeInTheDocument()
  })

  it('shows a badge for each standing a paper has, on its own line', () => {
    const backed = { claim: 'c', citations: [], verdicts: [{ verdict: 'supports' }] }
    const run = analysis({ id: 'x', title: 'Paper', claims: [claim, backed, backed] as Analysis['claims'] })
    wrap(<AnalysisList analyses={[run]} onOpen={vi.fn()} />)
    const row = screen.getByRole('button', { name: /^Paper/ })
    expect(within(row).getByText('Source contradicts: 1')).toBeInTheDocument()
    expect(within(row).getByText('Source backs it: 2')).toBeInTheDocument()
    expect(within(row).queryByText(/Source is silent/)).not.toBeInTheDocument()
  })

  it('keeps only the papers with a contradicted claim when Source contradicts is picked', () => {
    wrap(<AnalysisList analyses={list} onOpen={vi.fn()} />)
    pickStanding('Source contradicts')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Dense retrieval/ })).toBeInTheDocument()
    pickStanding('Source contradicts')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('offers one filter per standing that needs reading and some paper has', () => {
    const silent = { claim: 's', citations: [], verdicts: [{ verdict: 'insufficient' }] }
    const backed = { claim: 'b', citations: [], verdicts: [{ verdict: 'supports' }] }
    const runs = [...list, analysis({ id: 'a5', paper: '10.1/quiet', title: 'Quiet one', claims: [silent, backed] as Analysis['claims'] })]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Has a claim' }))
    const group = screen.getByRole('group', { name: 'Has a claim' })
    expect(within(group).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Source contradicts1',
      'Source is silent1',
      'Source backs it1',
    ])
    pickStanding('Source is silent')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Quiet one/ })).toBeInTheDocument()
  })

  it('keeps the papers that match any of the standings picked', () => {
    const silent = { claim: 's', citations: [], verdicts: [{ verdict: 'insufficient' }] }
    const runs = [...list, analysis({ id: 'a5', paper: '10.1/quiet', title: 'Quiet one', claims: [silent] as Analysis['claims'] })]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    pickStanding('Source contradicts')
    pickStanding('Source is silent')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('has no filter when no paper has a claim that needs reading', () => {
    wrap(<AnalysisList analyses={list.slice(1)} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Has a claim' })).not.toBeInTheDocument()
  })

  it('stops filtering by a standing once its last paper is gone', () => {
    const { rerender } = wrap(<AnalysisList analyses={list} onOpen={vi.fn()} />)
    pickStanding('Source contradicts')
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AnalysisList analyses={list.slice(1)} onOpen={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('names the search alone when a search leaves nothing and no filter is on', () => {
    wrap(<AnalysisList analyses={list} onOpen={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your analyses' }), { target: { value: 'nothing' } })
    expect(screen.getByText(/^No analysis matches “nothing”/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()
  })

  it('empties the search box when Clear search is pressed', () => {
    wrap(<AnalysisList analyses={list} onOpen={vi.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'Search your analyses' })
    fireEvent.change(search, { target: { value: 'nothing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('names the search and the filter when both leave nothing, and Clear filter resets the filter', () => {
    wrap(<AnalysisList analyses={list} onOpen={vi.fn()} />)
    pickStanding('Source contradicts')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your analyses' }), { target: { value: 'running' } })
    expect(screen.getByText(/No analysis matches “running”\s+with Source contradicts/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByRole('button', { name: /10\.2\/running/ })).toBeInTheDocument()
  })
})

describe('a failed run', () => {
  const failed = analysis({ status: 'error', message: 'litellm.RateLimitError: 429 deployment abc' })

  /** Renders the banner with the cached Analyses list that the later-run lookup reads. */
  function renderWithList(list: Analysis[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['analyses'], list)
    const onOpen = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <FailedRun analysis={failed} onOpen={onOpen} />
      </QueryClientProvider>,
    )
    return onOpen
  }
  const shortDate = (date: Date) => date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  it('says what happened in plain words and keeps the raw error behind Technical details', () => {
    wrap(<FailedRun analysis={failed} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The checking service was busy, so the analysis stopped.')
    expect(screen.getByText('Technical details')).toBeInTheDocument()
    // No way to open a new run was given, so no button.
    expect(screen.queryByRole('button', { name: 'Run it again' })).not.toBeInTheDocument()
  })

  it('offers a later finished run of the same paper, dated by when it ended, and opens it', () => {
    const completed = '2026-11-12T18:32:00'
    const onOpen = renderWithList([analysis({ id: 'later', completed, started: '2026-11-12T18:00:00' }), failed])
    expect(screen.getByText(`Finished ${shortDate(new Date(completed))}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the finished run' }))
    expect(onOpen).toHaveBeenCalledWith('later')
    // Running it again is still possible, but no longer the main action.
    expect(screen.getByRole('button', { name: 'Run it again' }).className).toContain('text-ink-muted')
    expect(screen.getByRole('button', { name: 'Open the finished run' }).className).toContain('bg-accent')
  })

  it('leaves the retry advice and the cost line out when a finished run is offered', () => {
    renderWithList([analysis({ id: 'later', completed: '2026-11-12T18:32:00' }), failed])
    expect(screen.getByRole('alert')).toHaveTextContent('The checking service was busy, so the analysis stopped.')
    expect(screen.queryByText(/Try again in a few minutes/)).not.toBeInTheDocument()
    expect(screen.queryByText(/about 4 minutes/)).not.toBeInTheDocument()
  })

  it('dates a later run by when it ran when it has no end time', () => {
    renderWithList([analysis({ id: 'later', started: '2026-11-12T14:05:00' }), failed])
    expect(screen.getByText(`Ran ${shortDate(new Date('2026-11-12T14:05:00'))}`)).toBeInTheDocument()
  })

  it('leaves the date out when the later run has no usable time', () => {
    renderWithList([analysis({ id: 'later', started: 'not a date' }), failed])
    expect(screen.getByRole('button', { name: 'Open the finished run' })).toBeInTheDocument()
    expect(screen.queryByText(/^(Finished|Started|Ran)/)).not.toBeInTheDocument()
  })

  it('leaves the date out when the later run has neither an end nor a start', () => {
    renderWithList([analysis({ id: 'later' }), failed])
    expect(screen.getByRole('button', { name: 'Open the finished run' })).toBeInTheDocument()
    expect(screen.queryByText(/^(Finished|Started|Ran)/)).not.toBeInTheDocument()
  })

  it('offers nothing when the newest finished run of the paper is older than this one', () => {
    renderWithList([failed, analysis({ id: 'older' })])
    expect(screen.queryByRole('button', { name: 'Open the finished run' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run it again' }).className).toContain('bg-accent')
  })

  it('offers nothing when a later run of the paper has not finished', () => {
    renderWithList([analysis({ id: 'later', status: 'running' }), failed])
    expect(screen.queryByRole('button', { name: 'Open the finished run' })).not.toBeInTheDocument()
  })

  it('offers nothing when this run is not in the cached list', () => {
    renderWithList([analysis({ id: 'other', paper: '10.9/other' })])
    expect(screen.queryByRole('button', { name: 'Open the finished run' })).not.toBeInTheDocument()
  })

  it('offers nothing before the Analyses list has been fetched', () => {
    wrap(<FailedRun analysis={failed} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Open the finished run' })).not.toBeInTheDocument()
  })

  it('runs the same paper again and hands over the new id', async () => {
    let started: (value: { id: string }) => void = () => {}
    gateway.startAnalysis.mockReturnValue(new Promise((resolve) => (started = resolve)))
    const onOpen = vi.fn()
    wrap(<FailedRun analysis={failed} onOpen={onOpen} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The checking service was busy, so the analysis stopped. Try again in a few minutes.')
    expect(screen.getByText(/about 4 minutes/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
    expect(await screen.findByRole('button', { name: 'Starting…' })).toBeDisabled()
    started({ id: 'new1' })
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new1'))
    expect(gateway.startAnalysis).toHaveBeenCalledWith('10.1/x', true)
  })

  it('turns Run it again off and says why while the checking server is offline', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['health'], { ok: true, features: { analyses: false } })
    render(
      <QueryClientProvider client={client}>
        <FailedRun analysis={failed} onOpen={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeDisabled()
    expect(screen.getByText(OFFLINE_REASON.analyses)).toBeInTheDocument()
    expect(screen.queryByText(/about 4 minutes/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Try again in a few minutes/)).not.toBeInTheDocument()
  })

  it('keeps Run it again off while offline even when a finished run is offered, and says why beside it', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['health'], { ok: true, features: { analyses: false } })
    client.setQueryData(['analyses'], [analysis({ id: 'later', completed: '2026-11-12T18:32:00' }), failed])
    render(
      <QueryClientProvider client={client}>
        <FailedRun analysis={failed} onOpen={vi.fn()} />
      </QueryClientProvider>,
    )
    const retry = screen.getByRole('button', { name: 'Run it again' })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAccessibleDescription(OFFLINE_REASON.analyses)
    expect(retry).not.toHaveAttribute('title')
    expect(screen.getByRole('button', { name: 'Open the finished run' })).toBeEnabled()
  })

  it('says so beside the buttons when the new run could not start while a finished run is offered', async () => {
    gateway.startAnalysis.mockRejectedValue(new Error('the queue is full'))
    renderWithList([analysis({ id: 'later', completed: '2026-11-12T18:32:00' }), failed])
    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
    expect(await screen.findByText('Could not start it: the queue is full')).toBeInTheDocument()
  })

  it('says so when the new run could not start', async () => {
    gateway.startAnalysis.mockRejectedValue(new Error('the queue is full'))
    wrap(<FailedRun analysis={failed} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
    expect(await screen.findByText('Could not start it: the queue is full')).toBeInTheDocument()
  })

  it('asks for the PDF again when the paper was an upload, and hides details that add nothing', () => {
    wrap(<FailedRun analysis={analysis({ status: 'error', paper: 'papers/x-1.pdf' })} onOpen={vi.fn()} />)
    expect(screen.getByText('Upload the PDF again to run a new check.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run it again' })).not.toBeInTheDocument()
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument()
  })
})

describe('deleting from the sidebar', () => {
  const rows = [analysis({ id: 'a1', title: 'First paper' }), analysis({ id: 'a2', paper: '10.1/second', title: 'Second paper' })]

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('hides the row at once and brings it back on Undo, without deleting it', async () => {
    wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of First paper' }))
    expect(screen.queryByText('First paper')).not.toBeInTheDocument()
    expect(toasts.shown[0].text).toBe('Deleted “First paper”')
    act(() => toasts.shown[0].undo?.())
    expect(screen.getByText('First paper')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_MS))
    expect(gateway.deleteAnalysis).not.toHaveBeenCalled()
  })

  it('puts the row back and says so when the delete fails', async () => {
    gateway.deleteAnalysis.mockRejectedValue(new Error('offline'))
    wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of First paper' }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_MS))
    await waitFor(() => expect(toasts.errors).toEqual(['Could not delete that analysis. It is back in the list.']))
    expect(screen.getByText('First paper')).toBeInTheDocument()
  })

  it.each(['a1', 'a2'])('reconciles selection %s only if that run was deleted', async (selected) => {
    const client = new QueryClient()
    const onSelect = vi.fn()
    const ui = (id: string | null) => (
      <QueryClientProvider client={client}><HistoryList analyses={rows} selected={id} onSelect={onSelect} /></QueryClientProvider>
    )
    const request = Promise.withResolvers<{ deleted: string }>()
    gateway.deleteAnalysis.mockReturnValue(request.promise)
    const { rerender } = render(ui(null))
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of First paper' }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_MS))
    rerender(ui(selected))
    await act(async () => request.resolve({ deleted: 'a1' }))
    expect(onSelect.mock.calls).toEqual(selected === 'a1' ? [[null]] : [])
  })

  it('sends a waiting delete when the list goes away before the undo window ends', async () => {
    gateway.deleteAnalysis.mockResolvedValue({ deleted: 'a2' })
    const { unmount } = wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of Second paper' }))
    unmount()
    expect(toasts.dismiss).toHaveBeenCalledWith('delete-a2')
    act(() => toasts.shown[0].undo?.()) // A click already queued as the toast disappears cannot undo the sent request.
    await waitFor(() => expect(gateway.deleteAnalysis).toHaveBeenCalledExactlyOnceWith('a2'))
  })

  it('lets a waiting delete fail quietly after the list has gone', async () => {
    gateway.deleteAnalysis.mockRejectedValue(new Error('offline'))
    const { unmount } = wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of Second paper' }))
    unmount()
    await waitFor(() => expect(gateway.deleteAnalysis).toHaveBeenCalledWith('a2'))
  })

  it('says "No analyses yet" once the last one is hidden', () => {
    wrap(<HistoryList analyses={rows.slice(0, 1)} selected={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of First paper' }))
    expect(screen.getByText('No analyses yet.')).toBeInTheDocument()
  })
})

describe('runs in the sidebar', () => {
  const rows = [
    analysis({ id: 'ok', paper: '10.1/a', title: 'Paper A' }),
    analysis({ id: 'old', paper: '10.1/a', status: 'error', title: 'Paper A' }),
    analysis({ id: 'lone', paper: '10.9/b', status: 'error', title: 'Paper B' }),
  ]

  it('lists a paper once, by its finished run, and keeps a lone stopped run with its badge', () => {
    wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    expect(screen.getAllByText('Paper A')).toHaveLength(1)
    expect(screen.getByText('Paper B')).toBeInTheDocument()
    expect(screen.getAllByText('Stopped')).toHaveLength(1)
    expect(screen.queryByText(/earlier run/)).not.toBeInTheDocument()
  })

  it('keeps the paper row on its finished run when an earlier stopped run is open, and marks it current', () => {
    wrap(<HistoryList analyses={rows} selected="old" onSelect={vi.fn()} />)
    expect(screen.getAllByText('Stopped')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Paper A/ })).toHaveAttribute('aria-current', 'true')
  })

  it('leaves the open paper where it is in the list and marks it current', () => {
    wrap(<HistoryList analyses={rows} selected="lone" onSelect={vi.fn()} />)
    const [first, second] = screen.getAllByRole('button', { name: /^Paper/ })
    expect(first).toHaveTextContent('Paper A')
    expect(first).not.toHaveAttribute('aria-current')
    expect(second).toHaveTextContent('Paper B')
    expect(second).toHaveAttribute('aria-current', 'true')
  })

  it('lists the papers newest first by the time each row shows', () => {
    const runs = [
      analysis({ id: 'o', paper: '10.1/o', title: 'Old', completed: '2026-11-01T10:00:00' }),
      analysis({ id: 'n', paper: '10.1/n', title: 'New', completed: '2026-11-12T10:00:00' }),
      analysis({ id: 'm', paper: '10.1/m', title: 'Middle', status: 'running', started: '2026-11-05T10:00:00' }),
    ]
    wrap(<HistoryList analyses={runs} selected={null} onSelect={vi.fn()} />)
    const titles = screen.getAllByRole('button', { name: /^(Old|Middle|New)/ }).map((row) => row.textContent)
    expect(titles[0]).toMatch(/^New/)
    expect(titles[1]).toMatch(/^Middle/)
    expect(titles[2]).toMatch(/^Old/)
  })

  it('says what each run holds under its title', () => {
    const refuted = { claim: 'c', citations: [], verdicts: [{ verdict: 'refutes' }] } as unknown as Analysis['claims'][number]
    wrap(
      <HistoryList
        analyses={[
          analysis({ id: 'one', paper: '10.1/1', title: 'One', claims: [refuted] }),
          analysis({ id: 'two', paper: '10.1/2', title: 'Two', claims: [refuted, refuted] }),
          analysis({ id: 'run', paper: '10.1/3', title: 'Going', status: 'running' }),
          analysis({ id: 'none', paper: '10.1/4', title: 'Empty' }),
        ]}
        selected={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('1 claim, 1 contradicted by a source')).toBeInTheDocument()
    expect(screen.getByText('2 claims, 2 contradicted by a source')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('No claims')).toBeInTheDocument()
  })

  it('gives a finished row a hover title with its counts, and a running one just its name', () => {
    const refuted = { claim: 'c', citations: [], verdicts: [{ verdict: 'refutes' }] } as unknown as Analysis['claims'][number]
    const backed = { claim: 'c', citations: [], verdicts: [{ verdict: 'supports' }] } as unknown as Analysis['claims'][number]
    wrap(
      <HistoryList
        analyses={[
          analysis({ id: 'one', paper: '10.1/1', title: 'One', claims: [refuted, backed, backed] }),
          analysis({ id: 'run', paper: '10.1/3', title: 'Going', status: 'running' }),
        ]}
        selected={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^One/ })).toHaveAttribute('title', 'One\nSource contradicts: 1 · Source backs it: 2')
    expect(screen.getByRole('button', { name: /^Going/ })).toHaveAttribute('title', 'Going')
  })

  it('titles a stopped newest run from another run of the same paper', () => {
    wrap(<HistoryList analyses={[analysis({ id: 'stopped', status: 'error' }), analysis({ id: 'ok', title: 'Paper A' })]} selected={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Paper A/ })).toBeInTheDocument()
  })

  it('deletes with the Delete key on the row, with the same undo', () => {
    wrap(<HistoryList analyses={[analysis({ id: 'a1', title: 'First paper' })]} selected={null} onSelect={vi.fn()} />)
    const row = screen.getByRole('button', { name: /^First paper/ })
    expect(row).toHaveAttribute('aria-keyshortcuts', 'Delete')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(toasts.shown).toHaveLength(0)
    fireEvent.keyDown(row, { key: 'Delete' })
    expect(toasts.shown[0].text).toBe('Deleted “First paper”')
    expect(screen.getByText('No analyses yet.')).toBeInTheDocument()
  })

  it('keeps the Delete button out of the Tab order', () => {
    wrap(<HistoryList analyses={rows.slice(0, 1)} selected={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Delete analysis of Paper A' })).toHaveAttribute('tabindex', '-1')
  })
})

describe('the open run in the sidebar', () => {
  const rowDetail = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) })

  it('says an earlier stopped run is open while the row counts a later finished one', () => {
    const runs = [analysis({ id: 'ok', title: 'Paper A' }), analysis({ id: 'old', status: 'error', title: 'Paper A' })]
    wrap(<HistoryList analyses={runs} selected="old" onSelect={vi.fn()} />)
    expect(rowDetail('Paper A')).toHaveTextContent('Viewing an earlier run · stopped')
  })

  it('says a later stopped run is open when it comes before the finished one in the list', () => {
    const runs = [analysis({ id: 'new', status: 'error', title: 'Paper A' }), analysis({ id: 'ok', title: 'Paper A' })]
    wrap(<HistoryList analyses={runs} selected="new" onSelect={vi.fn()} />)
    expect(rowDetail('Paper A')).toHaveTextContent('Viewing a later run · stopped')
  })

  it('says a finished run is open when the row counts another finished one', () => {
    const runs = [analysis({ id: 'first', title: 'Paper A' }), analysis({ id: 'second', title: 'Paper A' })]
    wrap(<HistoryList analyses={runs} selected="second" onSelect={vi.fn()} />)
    expect(rowDetail('Paper A')).toHaveTextContent('Viewing an earlier run · finished')
  })

  it('says a running run is open when another run of the paper is running too', () => {
    const runs = [analysis({ id: 'one', title: 'Paper A', status: 'running' }), analysis({ id: 'two', title: 'Paper A', status: 'running' })]
    wrap(<HistoryList analyses={runs} selected="two" onSelect={vi.fn()} />)
    expect(rowDetail('Paper A')).toHaveTextContent('Viewing an earlier run · running')
  })
})

describe('moving through the sidebar rows', () => {
  const papers = [
    analysis({ id: 'a', paper: '10.1/a', title: 'Paper A' }),
    analysis({ id: 'b', paper: '10.1/b', title: 'Paper B' }),
  ]
  const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) })

  it('is one Tab stop, on the open paper', () => {
    wrap(<HistoryList analyses={papers} selected="b" onSelect={vi.fn()} />)
    expect(row('Paper B')).toHaveAttribute('tabindex', '0')
    expect(row('Paper A')).toHaveAttribute('tabindex', '-1')
  })

  it('puts the first row on the Tab stop when nothing is open', () => {
    wrap(<HistoryList analyses={papers} selected={null} onSelect={vi.fn()} />)
    expect(row('Paper A')).toHaveAttribute('tabindex', '0')
    expect(row('Paper B')).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus to the next row on ArrowDown', () => {
    wrap(<HistoryList analyses={papers} selected={null} onSelect={vi.fn()} />)
    row('Paper A').focus()
    fireEvent.keyDown(row('Paper A'), { key: 'ArrowDown' })
    expect(row('Paper B')).toHaveFocus()
  })

  it('leaves focus alone when a key comes from the contents under the open row', () => {
    wrap(<HistoryList analyses={papers} selected="a" onSelect={vi.fn()} contents={<button type="button">Section</button>} />)
    const section = screen.getByRole('button', { name: 'Section' })
    section.focus()
    fireEvent.keyDown(section, { key: 'ArrowDown' })
    expect(section).toHaveFocus()
  })

  it('shows just the claim count when no source contradicts', () => {
    const backed = { claim: 'c', citations: [], verdicts: [{ verdict: 'supports' }] } as unknown as Analysis['claims'][number]
    wrap(<HistoryList analyses={[analysis({ id: 'a', title: 'Paper A', claims: [backed] })]} selected={null} onSelect={vi.fn()} />)
    expect(row('Paper A')).toHaveTextContent('1 claim')
    expect(row('Paper A')).not.toHaveTextContent('Source contradicts')
  })
})

describe('the Delete key on a sidebar row', () => {
  const rows = [analysis({ id: 'a1', title: 'First paper' })]
  const rowButton = () => screen.getByRole('button', { name: /^First paper/ })

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])('does nothing with %s held', (modifier) => {
    wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.keyDown(rowButton(), { key: 'Delete', [modifier]: true })
    expect(screen.getByText('First paper')).toBeInTheDocument()
    expect(toasts.shown).toHaveLength(0)
  })

  it('does nothing when the key was pressed on something inside the row', () => {
    wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.keyDown(screen.getByText('First paper'), { key: 'Delete' })
    expect(screen.getByText('First paper')).toBeInTheDocument()
    expect(toasts.shown).toHaveLength(0)
  })

  it('hides the row and offers Undo, and only deletes once the undo time has passed', async () => {
    wrap(<HistoryList analyses={rows} selected={null} onSelect={vi.fn()} />)
    fireEvent.keyDown(rowButton(), { key: 'Delete' })
    expect(screen.queryByText('First paper')).not.toBeInTheDocument()
    expect(toasts.shown[0].text).toBe('Deleted “First paper”')
    expect(gateway.deleteAnalysis).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_MS))
    await waitFor(() => expect(gateway.deleteAnalysis.mock.calls[0][0]).toBe('a1'))
  })
})

describe('the order and the memory of the Analyses list', () => {
  const claim = { claim: 'c', citations: [], verdicts: [{ verdict: 'refutes' }] } as unknown as Analysis['claims'][number]
  const rowTitles = () => screen.getAllByRole('button', { name: /^(Old|Middle|New|Oldest)/ }).map((button) => button.textContent)

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => vi.restoreAllMocks())

  it('lists the paper run most recently first', () => {
    const runs = [
      analysis({ id: 'o', paper: '10.1/o', title: 'Old', completed: '2026-11-01T10:00:00' }),
      analysis({ id: 'n', paper: '10.1/n', title: 'New', completed: '2026-11-12T10:00:00' }),
      analysis({ id: 'm', paper: '10.1/m', title: 'Middle', status: 'running', started: '2026-11-05T10:00:00' }),
    ]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    expect(rowTitles()[0]).toMatch(/^New/)
    expect(rowTitles()[1]).toMatch(/^Middle/)
    expect(rowTitles()[2]).toMatch(/^Old/)
  })

  it('counts facets from the same newest run it uses for the row', () => {
    const backed = { ...claim, verdicts: [{ verdict: 'supports' }] } as Analysis['claims'][number]
    const runs = [
      analysis({ id: 'old', title: 'Paper', completed: '2026-11-03T10:00:00', claims: [claim] }),
      analysis({ id: 'new', title: 'Paper', completed: '2026-11-12T10:00:00', claims: [backed] }),
    ]
    const onOpen = vi.fn()
    wrap(<AnalysisList analyses={runs} onOpen={onOpen} />)
    pickStanding('Source backs it')
    expect(screen.queryByRole('checkbox', { name: /Source contradicts/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Paper/ }))
    expect(onOpen).toHaveBeenCalledWith('new')
  })

  it('lists the earlier runs of a paper newest first', () => {
    const runs = [
      analysis({ id: 'a', title: 'Paper', completed: '2026-11-03T10:00:00' }),
      analysis({ id: 'b', title: 'Paper', completed: '2026-11-12T10:00:00' }),
      analysis({ id: 'c', title: 'Paper', completed: '2026-11-07T10:00:00' }),
    ]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    const earlier = screen.getByText('2 earlier runs').closest('details') as HTMLElement
    const dates = within(earlier).getAllByRole('button').map((button) => button.textContent)
    const day = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    expect(dates[0]).toContain(day('2026-11-07T10:00:00'))
    expect(dates[1]).toContain(day('2026-11-03T10:00:00'))
  })

  it('says why a stopped run stopped, in the row', () => {
    wrap(<AnalysisList analyses={[analysis({ status: 'error', title: 'Paper', message: 'litellm 429 too many requests' })]} onOpen={vi.fn()} />)
    expect(screen.getByText('The checking service was busy, so the analysis stopped.')).toBeInTheDocument()
  })

  it('saves the search in history and the filter in the URL before opening a row', () => {
    const onOpen = vi.fn()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120)
    wrap(<AnalysisList analyses={[analysis({ id: 'x', title: 'Dense retrieval', claims: [claim] })]} onOpen={onOpen} />)
    pickStanding('Source contradicts')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your analyses' }), { target: { value: 'dense' } })
    fireEvent.click(screen.getByRole('button', { name: /Dense retrieval/ }))
    expect(window.history.state.analysisList).toEqual({ query: 'dense', openGroups: [], scrollY: 120 })
    expect(window.location.search).toBe('?standing=refutes')
    expect(onOpen).toHaveBeenCalledWith('x')
  })

  it('restores search and scroll while preferring the URL over a stale filter snapshot', () => {
    window.history.replaceState({ analysisList: { query: 'dense', shows: ['supports'], openGroups: [], scrollY: 340 } }, '', '?standing=refutes')
    const runs = [analysis({ id: 'x', title: 'Dense retrieval', claims: [claim] }), analysis({ id: 'y', paper: '10.1/other', title: 'Other paper' })]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    expect(screen.getByRole('searchbox', { name: 'Search your analyses' })).toHaveValue('dense')
    expect(screen.getByRole('button', { name: /^Has a claim/ })).toHaveTextContent('Source contradicts')
    expect(screen.queryByRole('button', { name: /Other paper/ })).not.toBeInTheDocument()
    expect(window.scrollTo).toHaveBeenCalledWith(0, 340)
  })

  it('writes the standings picked to the address and clears them when none is left', () => {
    wrap(<AnalysisList analyses={[analysis({ id: 'x', title: 'Dense retrieval', claims: [claim] })]} onOpen={vi.fn()} />)
    pickStanding('Source contradicts')
    expect(new URLSearchParams(window.location.search).get('standing')).toBe('refutes')
    pickStanding('Source contradicts')
    expect(window.location.search).toBe('')
  })

  it('starts with the standing named in the address picked', () => {
    const named = { claim: 'n', citations: [{ doi: '10.1/d' }], named: ['10.1/d'], verdicts: [] }
    window.history.replaceState(null, '', '/?standing=named')
    const runs = [analysis({ id: 'x', title: 'Dense retrieval', claims: [claim] }), analysis({ id: 'y', paper: '10.1/tool', title: 'Own tool', claims: [named] as unknown as Analysis['claims'] })]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Has a claim/ })).toHaveTextContent('Names a tool or dataset')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Own tool/ })).toBeInTheDocument()
  })

  it('remembers an opened earlier-runs group and opens it again on Back', () => {
    const runs = [analysis({ id: 'new', title: 'Paper' }), analysis({ id: 'old', title: 'Paper' })]
    const { unmount } = wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    const earlier = () => screen.getByText('1 earlier run').closest('details') as HTMLDetailsElement
    earlier().open = true
    fireEvent(earlier(), new Event('toggle'))
    fireEvent.click(screen.getByRole('button', { name: /^Paper/ }))
    expect(window.history.state.analysisList.openGroups).toEqual(['new'])
    unmount()
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    expect(earlier()).toHaveAttribute('open')
  })

  it('forgets an earlier-runs group once the reader closes it again', () => {
    const runs = [analysis({ id: 'new', title: 'Paper' }), analysis({ id: 'old', title: 'Paper' })]
    wrap(<AnalysisList analyses={runs} onOpen={vi.fn()} />)
    const earlier = screen.getByText('1 earlier run').closest('details') as HTMLDetailsElement
    earlier.open = true
    fireEvent(earlier, new Event('toggle'))
    earlier.open = false
    fireEvent(earlier, new Event('toggle'))
    fireEvent.click(screen.getByRole('button', { name: /^Paper/ }))
    expect(window.history.state.analysisList.openGroups).toEqual([])
  })

  it('shows the worst three standings on a row and names the rest in a +N badge', () => {
    const verdict = (kind: string) => ({ claim: kind, citations: [], verdicts: [{ verdict: kind }] })
    const named = { claim: 'n', citations: [{ doi: '10.1/d' }], named: ['10.1/d'], verdicts: [] }
    const claims = [verdict('refutes'), verdict('insufficient'), verdict('supports'), named] as unknown as Analysis['claims']
    wrap(<AnalysisList analyses={[analysis({ id: 'x', title: 'Paper', claims })]} onOpen={vi.fn()} />)
    const row = screen.getByRole('button', { name: /^Paper/ })
    expect(within(row).getByText('+1')).toHaveAttribute('title', 'Names a tool or dataset: 1')
    expect(row).toHaveAttribute('title', expect.stringContaining('Names a tool or dataset: 1'))
  })

  it('starts at the top with no saved state', () => {
    wrap(<AnalysisList analyses={[analysis({ title: 'Paper' })]} onOpen={vi.fn()} />)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('starts at the top when the saved state has no scroll position', () => {
    window.history.replaceState({ analysisList: { query: '', shows: [], openGroups: [] } }, '')
    wrap(<AnalysisList analyses={[analysis({ title: 'Paper' })]} onOpen={vi.fn()} />)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })
})

it.each([true, false])('keeps a reference in progress when the history arrives (editing: %s)', (editing) => {
  const client = new QueryClient()
  const ui = (withHistory: boolean) => (
    <QueryClientProvider client={client}>
      <NewAnalysis onStarted={vi.fn()}>{withHistory && <div>Past analyses</div>}</NewAnalysis>
    </QueryClientProvider>
  )
  const { rerender } = render(ui(false))
  const input = screen.getByRole('textbox', { name: 'Paper to analyze' })
  if (editing) fireEvent.change(input, { target: { value: '10.1234/example' } })
  rerender(ui(true))
  expect(screen.getByText('Past analyses')).toBeInTheDocument()
  if (editing) {
    expect(screen.getByRole('textbox', { name: 'Paper to analyze' })).toBe(input)
    expect(input).toHaveValue('10.1234/example')
  } else {
    expect(screen.queryByRole('textbox', { name: 'Paper to analyze' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New analysis' })).toBeInTheDocument()
  }
})
