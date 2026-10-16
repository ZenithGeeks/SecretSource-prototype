/**
 * uploadAnalysis — where the gateway has a papers bucket, the PDF goes straight to Cloud Storage
 * with a signed URL, because the web proxy refuses a body over 4.5 MB (#266). Without one, it
 * goes through the gateway's multipart route as before.
 */

import { afterEach, expect, test, vi } from 'vitest'

import { api } from '../src/lib/api'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const pdf = new File(['%PDF-1.7 test'], 'Attention.pdf', { type: 'application/pdf' })

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('with a bucket, the PDF is PUT to the signed URL and the analysis starts from the upload', async () => {
  const ticket = {
    object: 'Attention-0123456789ab.pdf',
    url: 'https://storage.googleapis.com/papers/Attention-0123456789ab.pdf?X-Goog-Signature=x',
    headers: { 'Content-Type': 'application/pdf', 'x-goog-content-length-range': '13,13' },
  }
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/api/uploads')) return json(ticket)
    if (url === ticket.url) return new Response(null, { status: 200 })
    return json({ id: 'a1' })
  })
  vi.stubGlobal('fetch', fetchMock)

  expect(await api.uploadAnalysis(pdf, false)).toEqual({ id: 'a1' })

  const [asked, put, started] = fetchMock.mock.calls
  expect(JSON.parse(asked[1]!.body as string)).toEqual({ filename: 'Attention.pdf', size: 13 })
  expect(put[0]).toBe(ticket.url)
  expect(put[1]).toMatchObject({ method: 'PUT', headers: ticket.headers, body: pdf })
  expect(started[0]).toMatch(/\/api\/analyses\/from-upload$/)
  expect(JSON.parse(started[1]!.body as string)).toEqual({ object_name: ticket.object, verify: false })
})

test('without a bucket, the PDF goes through the gateway as a form upload', async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith('/api/uploads') ? json({ url: null }) : json({ id: 'a2' }),
  )
  vi.stubGlobal('fetch', fetchMock)

  expect(await api.uploadAnalysis(pdf, true)).toEqual({ id: 'a2' })

  const [, upload] = fetchMock.mock.calls
  expect(upload[0]).toMatch(/\/api\/analyses\/upload\?verify=true$/)
  expect((upload[1]!.body as FormData).get('file')).toBe(pdf)
})

test('a refused PUT stops before an analysis is started', async () => {
  const ticket = { object: 'a-0123456789ab.pdf', url: 'https://storage.test/put', headers: {} }
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/api/uploads') ? json(ticket) : new Response('SignatureDoesNotMatch', { status: 403 }),
  )
  vi.stubGlobal('fetch', fetchMock)

  await expect(api.uploadAnalysis(pdf, true)).rejects.toThrow('403: the upload to storage failed')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
