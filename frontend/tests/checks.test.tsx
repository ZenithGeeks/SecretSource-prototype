/** SCRUM-236: the real (gateway-backed) single-claim check path — api.ts's followEvents
 * extraction, writer.ts's checkClaim/getCheck, and the useCheck/useCheckClaim hooks. The
 * mocked draft-check flow (writerStore.ts, DraftCheck's issues panel) is untouched and not
 * covered here. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { api, followEvents } from '../src/lib/api'
import { useCheck, useCheckClaim } from '../src/lib/useWriter'
import { writerApi } from '../src/lib/writer'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function sseResponse(chunk: string) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

afterEach(() => vi.unstubAllGlobals())

// --- api.ts: followEvents, and that extracting it left api.onStages pointed the same place ---

test('followEvents fetches the given path under /api and parses each SSE data line as JSON', async () => {
  const fetchMock = vi.fn().mockResolvedValue(sseResponse('data: {"stage":"done","verdict":"supports"}\n\n'))
  vi.stubGlobal('fetch', fetchMock)

  const events: unknown[] = []
  const close = followEvents('/checks/x/events', (event) => events.push(event))

  await waitFor(() => expect(events).toEqual([{ stage: 'done', verdict: 'supports' }]))
  expect(fetchMock.mock.calls[0][0]).toBe('/api/checks/x/events')
  close()
})

test('api.onStages still targets /analyses/{id}/events after the followEvents extraction', async () => {
  const fetchMock = vi.fn().mockResolvedValue(sseResponse('data: {"stage":"extracting"}\n\n'))
  vi.stubGlobal('fetch', fetchMock)

  const stages: unknown[] = []
  const close = api.onStages('a1', (stage) => stages.push(stage))

  await waitFor(() => expect(stages).toEqual([{ stage: 'extracting' }]))
  expect(fetchMock.mock.calls[0][0]).toBe('/api/analyses/a1/events')
  close()
})

// --- writer.ts: checkClaim / getCheck ---

test('checkClaim posts the claim and a resolvable source key, not a display label', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'k1' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await writerApi.checkClaim('ColBERTv2 reduces index size by 6-10x.', '10.1145/3397271.3401075')

  expect(result).toEqual({ id: 'k1' })
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/checks')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({
    claim: 'ColBERTv2 reduces index size by 6-10x.',
    source: '10.1145/3397271.3401075',
  })
})

test('getCheck fetches one check by id', async () => {
  const check = {
    id: 'k1', status: 'done', claim: 'c', source: 's',
    verdict: 'supports', quote: 'q', reasoning: 'r', stages: [],
  }
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(check), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  expect(await writerApi.getCheck('k1')).toEqual(check)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/checks/k1')
})

// --- useWriter.ts: useCheck / useCheckClaim ---

test('useCheck returns a finished check without opening an event stream', async () => {
  // suggestion and quoteLocation are never part of a real CheckResult — nothing to fabricate.
  const check = {
    id: 'k1', status: 'done', claim: 'c', source: 's',
    verdict: 'supports', quote: 'the evidence says so', reasoning: 'it matches',
    stages: [{ stage: 'resolving' }, { stage: 'done', verdict: 'supports' }],
  }
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(check), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const { result } = renderHook(() => useCheck('k1'), { wrapper })

  await waitFor(() => expect(result.current.data).toEqual(check))
  // status is "done", not "running" — the SSE-follow effect must not have opened a stream.
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/checks/k1')
})

test('useCheck does nothing when given no id', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  const { result } = renderHook(() => useCheck(null), { wrapper })

  expect(result.current.data).toBeUndefined()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('a running check follows its events and resolves once done arrives', async () => {
  // Flips the moment the event stream is opened, not on a timer — a real refetch, triggered
  // by the stream's "done" event, races the rest of this async chain, so nothing here can
  // assert an intermediate "still running" moment without it being timing-dependent.
  let status: 'running' | 'done' = 'running'
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/checks/k1') {
      const body =
        status === 'running'
          ? { id: 'k1', status: 'running', claim: 'c', source: 's', stages: [{ stage: 'resolving' }] }
          : {
              id: 'k1', status: 'done', claim: 'c', source: 's', verdict: 'insufficient',
              quote: '', reasoning: 'no passages retrieved',
              stages: [{ stage: 'resolving' }, { stage: 'done', verdict: 'insufficient' }],
            }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }
    if (url === '/api/checks/k1/events') {
      status = 'done'
      // The real backend replays every already-recorded stage before new ones (main.py's
      // _event_stream) — "resolving" is already in the seeded "running" check, so it has to
      // be replayed here too, or the hook's replay-dedup mistakes "done" for that replay.
      return Promise.resolve(
        sseResponse('data: {"stage":"resolving"}\n\ndata: {"stage":"done","verdict":"insufficient"}\n\n'),
      )
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const { result } = renderHook(() => useCheck('k1'), { wrapper })

  await waitFor(() => expect(result.current.data?.status).toBe('done'))
  expect(result.current.data?.verdict).toBe('insufficient')
})

test('useCheckClaim starts a check and returns its id', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'k2' }), { status: 200 })))
  const { result } = renderHook(() => useCheckClaim(), { wrapper })

  result.current.mutate({ claim: 'c', source: '10.1/x' })

  await waitFor(() => expect(result.current.data).toEqual({ id: 'k2' }))
})
