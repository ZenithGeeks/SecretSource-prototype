/** lib/useAccountSettings.ts: the Settings modal's optimistic-write-then-PATCH pattern, and
 * hydrating the local stores from the server's preferences blob on open. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { getSettings, resetSettings } from '../src/lib/settings'
import { usePreferencesSync, useSetSetting } from '../src/lib/useAccountSettings'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => resetSettings())
afterEach(() => vi.unstubAllGlobals())

test('useSetSetting updates optimistically and keeps the value when the PATCH succeeds', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ theme: 'Dark' }), { status: 200 })),
  )
  const { result } = renderHook(() => useSetSetting(), { wrapper })

  result.current('theme', 'Dark')
  expect(getSettings().theme).toBe('Dark') // applied before the request resolves

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(getSettings().theme).toBe('Dark')
})

test('useSetSetting rolls the local value back when the PATCH fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server error', { status: 500 })))
  const { result } = renderHook(() => useSetSetting(), { wrapper })

  expect(getSettings().theme).toBe('Match system')
  result.current('theme', 'Dark')
  expect(getSettings().theme).toBe('Dark') // optimistic

  await waitFor(() => expect(getSettings().theme).toBe('Match system')) // rolled back
})

test('usePreferencesSync hydrates the local settings store from the server once per open', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ theme: 'Dark', notifyDone: true }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)

  const { rerender } = renderHook(({ open }: { open: boolean }) => usePreferencesSync(open), {
    wrapper,
    initialProps: { open: false },
  })
  expect(fetchMock).not.toHaveBeenCalled() // disabled while closed

  rerender({ open: true })
  await waitFor(() => expect(getSettings().theme).toBe('Dark'))
  expect(getSettings().notifyDone).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(1)

  // Closing and reopening fetches again, so another device's change still wins on open.
  rerender({ open: false })
  rerender({ open: true })
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
})

test('a PATCH response never overwrites a newer local value (fast typing, a double toggle)', async () => {
  // GET answers at once; each PATCH is held until the test releases it, in order.
  const release: ((response: Response) => void)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise<Response>((resolve) => release.push(resolve))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
  )
  const { result } = renderHook(() => ({ sync: usePreferencesSync(true), set: useSetSetting() }), { wrapper })
  await waitFor(() => expect(result.current.sync.data).toEqual({}))

  result.current.set('displayName', 'A')
  result.current.set('displayName', 'AB')
  expect(getSettings().displayName).toBe('AB')
  await waitFor(() => expect(release).toHaveLength(2))

  // The first PATCH answers with the blob as of that write — older than what is typed now.
  await act(async () => {
    release[0](new Response(JSON.stringify({ displayName: 'A' }), { status: 200 }))
    await new Promise((r) => setTimeout(r, 20))
  })
  expect(getSettings().displayName).toBe('AB') // not reverted to 'A'

  await act(async () => {
    release[1](new Response(JSON.stringify({ displayName: 'AB' }), { status: 200 }))
    await new Promise((r) => setTimeout(r, 20))
  })
  expect(getSettings().displayName).toBe('AB')
})
