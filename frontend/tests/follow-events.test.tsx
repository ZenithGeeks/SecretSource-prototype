/**
 * followEvents — the stream reader behind an analysis's progress and an Author check's. The
 * gateway sends a comment line (": keep-alive") while a stage has nothing to report; the
 * reader must hand on only events that carry data.
 */

import { afterEach, expect, test, vi } from 'vitest'

import { followEvents } from '../src/lib/api'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

/** A response whose body arrives in the given chunks and then stays open. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    },
  })
  return new Response(body, { status: 200 })
}

test('keep-alive comments between events are skipped, also when one is split across chunks', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    streamOf([
      'data: {"stage":"checking"}\n\n',
      ': keep-alive\n\n',
      ': keep-',
      'alive\n\ndata: {"stage":"checked"}\n\n',
      ': keep-alive\n\n',
      'data: {"stage":"done"}\n\n',
    ]),
  )
  vi.stubGlobal('fetch', fetchMock)

  const seen: string[] = []
  const opened = vi.fn()
  const close = followEvents<{ stage: string }>('/author/checks/c1/events', (event) => seen.push(event.stage), opened)
  await vi.waitFor(() => expect(seen).toContain('done'))
  close()

  expect(seen).toEqual(['checking', 'checked', 'done'])
  expect(opened).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(String(fetchMock.mock.calls[0][0])).toContain('/api/author/checks/c1/events')
})
