/** lib/newVersion.ts: one toast when the deployed entry script differs from the running one. */

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { toast } from 'sonner'
import { watchForNewVersion } from '../src/lib/newVersion'

vi.mock('sonner', () => ({ toast: vi.fn() }))

function page(entry: string) {
  return `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script></head></html>`
}

function serve(html: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html)))
}

beforeEach(() => {
  vi.useFakeTimers()
  document.head.innerHTML = '<script type="module" src="/assets/index-old.js"></script>'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(toast).mockClear()
})

test('a new entry script shows one toast, and checks stop after it', async () => {
  serve(page('/assets/index-new.js'))
  watchForNewVersion()

  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

  expect(toast).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('the same build, or an error page, shows nothing', async () => {
  serve(page('/assets/index-old.js'))
  watchForNewVersion()
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

  serve('<html><body>502 Bad Gateway</body></html>')
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

  expect(toast).not.toHaveBeenCalled()
})
