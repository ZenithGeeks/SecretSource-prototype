/**
 * useAssistant when answers overlap, break off or fail: a question the reader leaves behind (a
 * newer question, Stop, New chat) must not change the chat they moved to.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadChat, useAssistant } from '../src/lib/assistant'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const CONTEXT = { screen: 'library' }
const encoder = new TextEncoder()

const sse = (events: object[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200 })
const aborted = () => new DOMException('The operation was aborted.', 'AbortError')

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** A fetch that rejects when its request is aborted, as a real one does. */
function untilAborted(init?: RequestInit) {
  return new Promise<Response>((_, reject) => {
    if (init?.signal?.aborted) reject(aborted())
    init?.signal?.addEventListener('abort', () => reject(aborted()))
  })
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined

/** Answers the chat routes unless `route` answers first. */
function gateway(route: Route = () => undefined) {
  let created = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const own = route(url, init)
      if (own) return own
      if (url.endsWith('/assistant/chats') && init?.method === 'POST') return Response.json({ id: `chat${++created}`, title: '', updated: 0 })
      if (url.endsWith('/messages')) return sse([{ type: 'statement', index: 0, text: 'S.', source: 'a.pdf' }, { type: 'done', statements: 1 }])
      return Response.json({ messages: [] })
    }),
  )
}

const hook = () => renderHook(() => useAssistant())

describe('answering a question', () => {
  it('marks an answer failed when its stream ends without done', async () => {
    gateway((url) => (url.endsWith('/messages') ? sse([{ type: 'statement', index: 0, text: 'S.', source: 'a.pdf' }]) : undefined))
    const { result } = hook()

    await act(() => result.current.ask('Why?', CONTEXT))

    expect(result.current.turns[0]).toMatchObject({ status: 'failed', statements: [{ text: 'S.' }] })
    expect(result.current.answering).toBe(false)
  })

  it('marks an answer failed when the gateway refuses the question', async () => {
    gateway((url) => (url.endsWith('/messages') ? new Response('down', { status: 503 }) : undefined))
    const { result } = hook()

    await act(() => result.current.ask('Why?', CONTEXT))

    expect(result.current.turns[0].status).toBe('failed')
  })

  it('keeps each answer on its own turn when the reader asks twice', async () => {
    gateway()
    const { result } = hook()

    await act(() => result.current.ask('One?', CONTEXT))
    await act(() => result.current.ask('Two?', CONTEXT))

    expect(result.current.turns.map((turn) => [turn.question, turn.status, turn.statements.length])).toEqual([
      ['One?', 'done', 1],
      ['Two?', 'done', 1],
    ])
  })

  it('does not post a question to a chat that a newer question has already replaced', async () => {
    const slowChat = deferred<Response>()
    let creates = 0
    gateway((url, init) => (url.endsWith('/assistant/chats') && init?.method === 'POST' && ++creates === 1 ? slowChat.promise : undefined))
    const { result } = hook()

    let first!: Promise<void>
    act(() => {
      first = result.current.ask('First?', CONTEXT)
    })
    await act(() => result.current.ask('Second?', CONTEXT))
    await act(async () => {
      slowChat.resolve(Response.json({ id: 'late', title: '', updated: 0 }))
      await first
    })

    expect(result.current.chatId).toBe('chat1')
    const posted = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(posted.some((url) => url.includes('/late/'))).toBe(false)
  })

  it('leaves a stopped answer stopped when its stream ends afterwards', async () => {
    let feed!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (controller) => void (feed = controller) })
    gateway((url) => (url.endsWith('/messages') ? new Response(body, { status: 200 }) : undefined))
    const { result } = hook()

    let asked!: Promise<void>
    act(() => {
      asked = result.current.ask('Why?', CONTEXT)
    })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(true))
    act(() => result.current.stop())
    await act(async () => {
      feed.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'statement', index: 0, text: 'Late.', source: 'a.pdf' })}\n\n`))
      feed.close()
      await asked
    })

    expect(result.current.turns[0]).toMatchObject({ status: 'stopped', statements: [] })
  })

  it('says nothing more about an answer that Stop cut off mid-request', async () => {
    gateway((url, init) => (url.endsWith('/messages') ? untilAborted(init) : undefined))
    const { result } = hook()

    let asked!: Promise<void>
    act(() => {
      asked = result.current.ask('Why?', CONTEXT)
    })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(true))
    act(() => result.current.stop())
    await act(() => asked)

    expect(result.current.turns[0].status).toBe('stopped')
  })
})

describe('running a /command', () => {
  const command = { name: 'get_gaps', args: {} }

  it('ignores a result that arrives after Stop', async () => {
    const slow = deferred<Response>()
    gateway((url) => (url.includes('/agent/tools/') ? slow.promise : undefined))
    const { result } = hook()

    let ran!: Promise<void>
    act(() => {
      ran = result.current.run('/get_gaps', command)
    })
    act(() => result.current.stop())
    await act(async () => {
      slow.resolve(Response.json({ notBacked: [1] }))
      await ran
    })

    expect(result.current.turns[0]).toMatchObject({ status: 'stopped', command: '/get_gaps' })
    expect(result.current.turns[0].view).toBeUndefined()
  })

  it('ignores a request that Stop aborted', async () => {
    gateway((url, init) => (url.includes('/agent/tools/') ? untilAborted(init) : undefined))
    const { result } = hook()

    let ran!: Promise<void>
    act(() => {
      ran = result.current.run('/get_gaps', command)
    })
    act(() => result.current.stop())
    await act(() => ran)

    expect(result.current.turns[0].status).toBe('stopped')
  })

  it('leaves the turn answering when the request itself was aborted', async () => {
    gateway((url) => (url.includes('/agent/tools/') ? Promise.reject(aborted()) : undefined))
    const { result } = hook()

    await act(() => result.current.run('/get_gaps', command))

    expect(result.current.turns[0].status).toBe('answering')
  })

  it('says "unknown error" when the failure is not an Error', async () => {
    gateway((url) => (url.includes('/agent/tools/') ? Promise.reject('boom') : undefined))
    const { result } = hook()

    await act(() => result.current.run('/get_gaps', command))

    expect(result.current.turns[0]).toMatchObject({ status: 'done', view: { kind: 'message', text: '/get_gaps could not run: unknown error' } })
  })
})

describe('opening a saved chat', () => {
  it('reads an answer that has no question before it as nothing', async () => {
    gateway((url) =>
      url.endsWith('/assistant/chats/c9')
        ? Response.json({ messages: [{ role: 'assistant', statements: [] }, { role: 'user', text: 'Q?' }] })
        : undefined,
    )

    expect(await loadChat('c9')).toMatchObject([{ question: 'Q?', status: 'failed' }])
  })

  it('does not report a failed load of a chat the reader has already left', async () => {
    const slow = deferred<Response>()
    gateway((url) => (url.endsWith('/assistant/chats/c9') ? slow.promise : undefined))
    const { result } = hook()

    let opened!: Promise<void>
    act(() => {
      opened = result.current.openChat('c9')
    })
    act(() => result.current.newChat())
    await act(async () => {
      slow.resolve(new Response('asleep', { status: 503 }))
      await opened
    })

    expect(result.current.openFailed).toBe(false)
    expect(result.current.opening).toBe(false)
  })
})
