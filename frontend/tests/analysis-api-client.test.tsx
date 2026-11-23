/** The gateway client: the token it sends, what it does when refused, and the event streams. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  session: { access_token: 'tok' } as { access_token: string } | null,
  enabled: true,
  endSession: vi.fn(async () => {}),
}))

vi.mock('../src/lib/supabase', () => ({
  get supabase() {
    return auth.enabled ? { auth: { getSession: async () => ({ data: { session: auth.session } }) } } : null
  },
}))
vi.mock('../src/lib/useAuth', () => ({ endSession: auth.endSession }))

import {
  api,
  fetchFile,
  figureImageUrl,
  followEvents,
  paperName,
  postEvents,
  reasonText,
  request,
  requestBlob,
  SignedOut,
} from '../src/lib/api'

const encoder = new TextEncoder()

function streamOf(...chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => handler(String(url), init))
  vi.stubGlobal('fetch', mock)
  return mock
}

beforeEach(() => {
  auth.session = { access_token: 'tok' }
  auth.enabled = true
  auth.endSession.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('small helpers', () => {
  it('takes a paper name from the end of a path', () => {
    expect(paperName('colbert_server/papers/x.pdf')).toBe('x.pdf')
    expect(paperName('x.pdf')).toBe('x.pdf')
  })

  it('builds a figure url from the file name alone', () => {
    expect(figureImageUrl('a b.pdf', '/papers/figures/a/figure-3.png')).toBe('/api/papers/a%20b.pdf/figures/figure-3.png')
  })

  it('says something for a reason code this build does not know', () => {
    expect(reasonText('withdrawn')).toBe('withdrawn by its authors on arXiv')
    expect(reasonText('new-code')).toBe('checking it failed')
    expect(reasonText()).toBe('checking it failed')
  })
})

describe('requests', () => {
  it('sends the signed-in token and parses the answer', async () => {
    const fetchMock = stubFetch(() => json([{ id: 'a' }]))
    expect(await api.listAnalyses()).toEqual([{ id: 'a' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyses')
    expect((init!.headers as Headers).get('Authorization')).toBe('Bearer tok')
  })

  it('sends no token when login is off', async () => {
    auth.enabled = false
    const fetchMock = stubFetch(() => json({}))
    await request('/analyses')
    expect((fetchMock.mock.calls[0][1]!.headers as Headers).has('Authorization')).toBe(false)
  })

  it('signs out instead of asking as nobody when the session is gone', async () => {
    auth.session = null
    const fetchMock = stubFetch(() => json({}))
    await expect(request('/analyses')).rejects.toBeInstanceOf(SignedOut)
    expect(auth.endSession).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('signs out when the gateway refuses the token', async () => {
    stubFetch(() => new Response('no', { status: 401 }))
    await expect(request('/analyses')).rejects.toThrow('the session has expired, sign in again')
    expect(auth.endSession).toHaveBeenCalledTimes(1)
  })

  it('does not sign out on a 401 when login is off', async () => {
    auth.enabled = false
    stubFetch(() => new Response('nope', { status: 401 }))
    await expect(request('/analyses')).rejects.toThrow('401: nope')
    expect(auth.endSession).not.toHaveBeenCalled()
  })

  it('throws the status and body of a failed request', async () => {
    stubFetch(() => new Response('gone', { status: 404 }))
    await expect(request('/analyses/x')).rejects.toThrow('404: gone')
  })

  it('returns a blob for a route that answers with a file', async () => {
    stubFetch(() => new Response('pdf-bytes'))
    expect(await (await requestBlob('/report')).text()).toBe('pdf-bytes')
  })
})

describe('fetchFile', () => {
  it('fetches with the token', async () => {
    const fetchMock = stubFetch(() => new Response('bytes'))
    expect(await (await fetchFile('/api/papers/x.pdf')).text()).toBe('bytes')
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer tok' } })
  })

  it('fetches with no header when login is off', async () => {
    auth.enabled = false
    const fetchMock = stubFetch(() => new Response('bytes'))
    await fetchFile('/api/papers/x.pdf')
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: {} })
  })

  it('throws for a missing file and signs out for a refused one', async () => {
    stubFetch(() => new Response('', { status: 404 }))
    await expect(fetchFile('/api/papers/x.pdf')).rejects.toThrow('404: /api/papers/x.pdf')
    stubFetch(() => new Response('', { status: 401 }))
    await expect(fetchFile('/api/papers/x.pdf')).rejects.toBeInstanceOf(SignedOut)
  })
})

describe('api calls', () => {
  it('names each route and method', async () => {
    const fetchMock = stubFetch(() => json({}))
    const controller = new AbortController()
    await api.getAnalysis('a1', controller.signal)
    await api.deleteAnalysis('a1')
    await api.stopAnalysis('a1')
    await api.disputeVerdict('a1', 2, 'src', 'wrong page')
    await api.startAnalysis('x.pdf', true)
    await api.findInPaper('x y.pdf', 'q&a')
    await api.findInPaper('x.pdf', 'q', 4)
    const seen = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
    expect(seen).toEqual([
      'GET /api/analyses/a1',
      'DELETE /api/analyses/a1',
      'POST /api/analyses/a1/stop',
      'POST /api/analyses/a1/disputes',
      'POST /api/analyses',
      'GET /api/papers/x%20y.pdf/find?q=q%26a',
      'GET /api/papers/x.pdf/find?q=q&page=4',
    ])
    expect(fetchMock.mock.calls[3][1]!.body).toBe(JSON.stringify({ claim: 2, source: 'src', note: 'wrong page' }))
    expect(fetchMock.mock.calls[4][1]!.body).toBe(JSON.stringify({ paper: 'x.pdf', verify: true }))
  })
})

describe('uploadReferencePdf', () => {
  it('posts the PDF for one citation and returns the stored name', async () => {
    const file = new File(['%PDF'], 'gmres.pdf', { type: 'application/pdf' })
    const fetchMock = stubFetch(() => json({ ref: 'b13', pdf: 'gmres-abc.pdf' }))
    expect(await api.uploadReferencePdf('a/1', 'b 13', file)).toEqual({ ref: 'b13', pdf: 'gmres-abc.pdf' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyses/a%2F1/references/b%2013/pdf')
    expect(init?.method).toBe('POST')
    expect((init!.body as FormData).get('file')).toBe(file)
  })
})

describe('uploadAnalysis', () => {
  const file = new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })

  it('goes through the gateway when there is no papers bucket', async () => {
    const fetchMock = stubFetch((url) => (url.endsWith('/uploads') ? json({ url: null }) : json({ id: 'new' })))
    expect(await api.uploadAnalysis(file, false)).toEqual({ id: 'new' })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/analyses/upload?verify=false')
    expect((init!.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('puts the PDF straight to storage when there is a bucket', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/uploads')) return json({ url: 'https://storage/put', object: 'obj-1', headers: { 'x-a': 'b' } })
      if (url === 'https://storage/put') return new Response('', { status: 200 })
      return json({ id: 'new' })
    })
    expect(await api.uploadAnalysis(file, true)).toEqual({ id: 'new' })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'x-a': 'b' }, body: file })
    expect(fetchMock.mock.calls[2][0]).toBe('/api/analyses/from-upload')
    expect(fetchMock.mock.calls[2][1]!.body).toBe(JSON.stringify({ object_name: 'obj-1', verify: true }))
  })

  it('fails when storage refuses the PDF', async () => {
    stubFetch((url) =>
      url.endsWith('/uploads') ? json({ url: 'https://storage/put', object: 'o', headers: {} }) : new Response('', { status: 403 }),
    )
    await expect(api.uploadAnalysis(file, true)).rejects.toThrow('403: the upload to storage failed')
  })
})

describe('postEvents', () => {
  it('posts the body and hands on each event', async () => {
    const fetchMock = stubFetch(() => streamOf('data: {"n":1}\n\ndata:{"n":2}\n\n'))
    const seen: unknown[] = []
    await postEvents('/ask', { q: 'why' }, (event) => seen.push(event), new AbortController().signal)
    expect(seen).toEqual([{ n: 1 }, { n: 2 }])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ q: 'why' }) })
  })

  it('joins the lines of one event and skips events with no data', async () => {
    stubFetch(() => streamOf('event: x\n\ndata: [1,\n', 'data: 2]\n\n'))
    const seen: unknown[] = []
    await postEvents('/ask', {}, (event) => seen.push(event), new AbortController().signal)
    expect(seen).toEqual([[1, 2]])
  })

  it('fails when the answer has no stream', async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    await expect(postEvents('/ask', {}, () => {}, new AbortController().signal)).rejects.toThrow('no answer stream from /ask')
  })
})

describe('followEvents', () => {
  it('reports the open and each event, and stops once closed', async () => {
    const fetchMock = stubFetch(() => streamOf('data: {"stage":"done"}\n\n'))
    const seen: unknown[] = []
    const onOpen = vi.fn()
    const close = api.onStages('a1', (stage) => seen.push(stage), onOpen)
    await vi.waitFor(() => expect(seen).toEqual([{ stage: 'done' }]))
    close()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/analyses/a1/events')
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('asks with no header when login is off', async () => {
    auth.enabled = false
    const fetchMock = stubFetch(() => streamOf('data: 1\n\n'))
    const seen: number[] = []
    const close = followEvents<number>('/e', (event) => seen.push(event))
    await vi.waitFor(() => expect(seen).toEqual([1]))
    close()
    expect(fetchMock.mock.calls[0][1]!.headers).toEqual({})
  })

  it('does not retry a refused stream', async () => {
    const fetchMock = stubFetch(() => new Response('', { status: 404 }))
    const onOpen = vi.fn()
    followEvents('/e', () => {}, onOpen)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onOpen).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a response with no body', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }))
    followEvents('/e', () => {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('stops when the session is gone', async () => {
    auth.session = null
    const fetchMock = stubFetch(() => streamOf())
    followEvents('/e', () => {})
    await vi.waitFor(() => expect(auth.endSession).toHaveBeenCalledTimes(1))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reconnects after a pause when the connection drops', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchMock = stubFetch(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('network')
      return streamOf('data: 7\n\n')
    })
    const seen: number[] = []
    const close = followEvents<number>('/e', (event) => seen.push(event))
    await vi.advanceTimersByTimeAsync(3100)
    close()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(seen).toEqual([7])
  })

  it('does not reconnect after it was closed mid-request', async () => {
    let reject: (error: Error) => void = () => {}
    const fetchMock = stubFetch(() => new Promise<Response>((_, fail) => (reject = fail)))
    const close = followEvents('/e', () => {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    close()
    reject(new Error('aborted'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
