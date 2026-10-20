/** Notices for papers the viewer added: a toast when one this tab saw running finishes, only for
 * the viewer's own papers, and a count in the title of a background tab. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { POOL_POLL_MS, type Pool } from '../src/lib/labeling'
import { Toaster } from '../src/components/Toaster'
import { usePaperNotices } from '../src/roles/labeler/usePaperNotices'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type Paper = Pool['papers'][number]

const paper = (id: string, extra: Partial<Paper> = {}): Paper => ({
  analysis_id: id,
  title: `Paper ${id}`,
  topic: 'CV',
  claims: 0,
  judged: 0,
  labelers: [],
  status: 'running',
  reason: '',
  mine: true,
  added_by: 'Chanya',
  ...extra,
})

const pool = (papers: Paper[]): Pool => ({ topics: ['CV'], me: 'Chanya', people: [], papers })

/** Answers each pool request with the next of `answers`, then keeps the last. */
function gateway(answers: Pool[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(answers.length > 1 ? answers.shift() : answers[0])),
  )
}

function Notices({ onOpen }: { onOpen: (id: string) => void }) {
  usePaperNotices(onOpen)
  return <Toaster />
}

function renderNotices(onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Notices onOpen={onOpen} />
    </QueryClientProvider>,
  )
  return { client, onOpen }
}

describe('paper notices', () => {
  it('says when a paper the viewer added is ready, and opens it', async () => {
    gateway([pool([paper('a')]), pool([paper('a', { status: 'done', claims: 12 })])])
    const { client, onOpen } = renderNotices()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await act(() => client.refetchQueries())

    expect(await screen.findByText('Ready to label')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onOpen).toHaveBeenCalledWith('a')
    await waitFor(() => expect(screen.queryByText('Ready to label')).not.toBeInTheDocument())
  })

  it('says why a paper failed, and keeps it until dismissed', async () => {
    gateway([pool([paper('a')]), pool([paper('a', { status: 'error', reason: 'No open-access PDF.' })])])
    const { client } = renderNotices()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await act(() => client.refetchQueries())

    expect(await screen.findByText(/No open-access PDF\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close toast' }))
    await waitFor(() => expect(screen.queryByText(/No open-access PDF\./)).not.toBeInTheDocument())
  })

  it("stays quiet for old news and other people's papers", async () => {
    gateway([
      pool([paper('done', { status: 'done' }), paper('theirs', { mine: false })]),
      pool([paper('done', { status: 'done' }), paper('theirs', { mine: false, status: 'done' })]),
    ])
    const { client } = renderNotices()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await act(() => client.refetchQueries())

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Ready to label')).not.toBeInTheDocument()
  })

  it('asks again soon while a paper the viewer added is running, and slows down after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    gateway([pool([paper('a')]), pool([paper('a', { status: 'done' })])])
    renderNotices()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await act(() => vi.advanceTimersByTimeAsync(POOL_POLL_MS.reading))
    expect(await screen.findByText('Ready to label')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(POOL_POLL_MS.reading * 2))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('counts finished papers in the title of a background tab until the viewer comes back', async () => {
    document.title = 'SecretSource'
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    gateway([pool([paper('a'), paper('b')]), pool([paper('a', { status: 'done' }), paper('b', { status: 'error' })])])
    const { client } = renderNotices()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await act(() => client.refetchQueries())
    await waitFor(() => expect(document.title).toBe('(2) SecretSource'))

    hidden.mockReturnValue(false)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(document.title).toBe('SecretSource')
    hidden.mockRestore()
  })
})
