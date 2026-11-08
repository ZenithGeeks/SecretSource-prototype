/** lib/agentAccess.ts: saving the Settings, Agents level. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { useAgentAccess } from '../src/lib/agentAccess'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => vi.unstubAllGlobals())

/** A preferences server that applies a PATCH when the test lets it arrive, as the backend does:
 * whichever PATCH arrives last wins. */
function fakeServer() {
  let stored: Record<string, unknown> = {}
  const arrivals: (() => void)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return Promise.resolve(Response.json(stored))
      const { patch } = JSON.parse(init.body as string)
      return new Promise<Response>((resolve) =>
        arrivals.push(() => {
          stored = { ...stored, ...patch }
          resolve(Response.json(stored))
        }),
      )
    }),
  )
  return { arrivals, stored: () => stored }
}

test('the last click wins even when an earlier save would arrive after it', async () => {
  const server = fakeServer()
  const { result } = renderHook(() => useAgentAccess(), { wrapper })
  await waitFor(() => expect(result.current.access).toEqual({ level: 'full' }))

  act(() => {
    result.current.update(() => ({ level: 'read' }))
    result.current.update(() => ({ level: 'custom', tools: ['list_papers'] }))
  })

  // Let the newest waiting PATCH arrive first, so an unordered pair would end on 'read'.
  for (let round = 0; round < 5; round++) {
    await act(async () => {
      server.arrivals.pop()?.()
      await new Promise((r) => setTimeout(r, 20))
    })
  }

  expect(server.stored().agentAccess).toEqual({ level: 'custom', tools: ['list_papers'] })
  await waitFor(() => expect(result.current.access).toEqual({ level: 'custom', tools: ['list_papers'] }))
})
