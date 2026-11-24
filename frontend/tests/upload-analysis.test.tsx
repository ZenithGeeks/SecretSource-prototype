import { afterEach, expect, test, vi } from 'vitest'

import { api } from '../src/lib/api'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const pdf = new File(['%PDF-1.7 test'], 'Attention.pdf', { type: 'application/pdf' })

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test.each([true, false])('posts the PDF directly to the gateway with verify=%s', async (verify) => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ id: 'a1' }))
  vi.stubGlobal('fetch', fetchMock)

  expect(await api.uploadAnalysis(pdf, verify)).toEqual({ id: 'a1' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe(`/api/analyses/upload?verify=${verify}`)
  expect(init?.method).toBe('POST')
  expect((init!.body as FormData).get('file')).toBe(pdf)
})

test('surfaces a gateway rejection without retrying the upload', async () => {
  const fetchMock = vi.fn(async () => new Response('PDF exceeds the upload limit', { status: 413 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(api.uploadAnalysis(pdf, true)).rejects.toThrow('413: PDF exceeds the upload limit')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
