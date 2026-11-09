/** The corners of usePaperNotices that paper-notices.test.tsx leaves out. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Pool } from '../src/lib/labeling'
import { usePaperNotices } from '../src/roles/labeler/usePaperNotices'

const notice = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('../src/lib/desktopNotice', () => ({ showDoneNotice: notice.show }))
// A local .env with Supabase set would otherwise turn login on and stop the pool request.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => {
  vi.unstubAllGlobals()
  notice.show.mockReset()
})

const paper = (status: 'running' | 'done'): Pool['papers'][number] => ({
  analysis_id: 'a',
  title: 'Paper a',
  topic: 'CV',
  claims: 0,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status,
  reason: '',
  mine: true,
  added_by: 'Chanya',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
})

function Notices({ onOpen }: { onOpen: (id: string) => void }) {
  usePaperNotices(onOpen)
  return null
}

async function renderUntilDone(onOpen: (id: string) => void) {
  const answers = [[paper('running')], [paper('done')]]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ topics: [], me: 'Chanya', people: [], papers: answers.length > 1 ? answers.shift() : answers[0] })),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Notices onOpen={onOpen} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await act(() => client.refetchQueries())
}

it('opens the paper when the desktop notice is clicked', async () => {
  const onOpen = vi.fn()
  await renderUntilDone(onOpen)

  await waitFor(() => expect(notice.show).toHaveBeenCalledWith('Ready to label', 'Paper a', 'a', expect.any(Function)))
  notice.show.mock.calls[0][3]()
  expect(onOpen).toHaveBeenCalledWith('a')
})

it('keeps the count in the title while the tab is still hidden', async () => {
  document.title = 'SecretSource'
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await renderUntilDone(vi.fn())
  await waitFor(() => expect(document.title).toBe('(1) SecretSource'))

  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })

  expect(document.title).toBe('(1) SecretSource')
  hidden.mockRestore()
})
