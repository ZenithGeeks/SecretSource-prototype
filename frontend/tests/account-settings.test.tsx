/** lib/useAccountSettings.ts: the Settings modal's optimistic-write-then-PATCH pattern, and
 * hydrating the local stores from the server's preferences blob on open. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { getSettings, resetSettings } from '../src/lib/settings'
import { usePreferencesSync, useSetSetting } from '../src/lib/useAccountSettings'

// Signed-out, no Supabase: request() sends without a token instead of throwing SignedOut,
// whatever a local .env says (SCRUM-245 / #239).
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

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
})
