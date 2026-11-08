/** The owner can dispute a verdict, and "Show in cited paper" finds a quote that is not on the
 * page its passage was filed under (#856). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ClaimCard } from '../src/components/ClaimCard'
import type { Claim, Verdict } from '../src/lib/api'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

const kotonya = { title: 'Explainable fact-checking', authors: ['Neema Kotonya'], year: '2020', doi: '', arxiv: '2011.03870', url: '' }

const verdict = {
  cited: '2011.03870',
  source: 'kotonya.pdf',
  verdict: 'insufficient',
  quote: 'Explanations should be faithful.',
  reasoning: 'The source does not say this.',
  evidence: [{ text: 'Explanations should be faithful. More text.', page: 6 }],
  pages: [],
} as unknown as Verdict

const claim: Claim = {
  claim: 'Explanations must be faithful.',
  citations: [kotonya],
  verdicts: [verdict],
  unchecked: [],
}

afterEach(() => vi.unstubAllGlobals())

function renderCard(onShow = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ClaimCard claim={claim} index={0} standing="insufficient" analysisId="a1" onShow={onShow} />
    </QueryClientProvider>,
  )
  return onShow
}

test('the owner disputes a verdict with a reason', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ claim: 0, source: 'kotonya.pdf', note: 'x', at: 1 })))
  vi.stubGlobal('fetch', fetch)
  renderCard()

  expect(screen.getByText('Checked by an AI judge, which can be wrong.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Disagree?' }))
  fireEvent.change(screen.getByLabelText(/What did the judge get wrong/), { target: { value: 'Table 2 backs it' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => expect(fetch).toHaveBeenCalled())
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toContain('/analyses/a1/disputes')
  expect(JSON.parse(String(init.body))).toEqual({ claim: 0, source: 'kotonya.pdf', note: 'Table 2 backs it' })
})

test('a quote that is not on its passage page is looked for in the whole paper', async () => {
  const found = { page: 5, boxes: [{ x0: 1, y0: 1, x1: 2, y1: 2 }], page_width: 600, page_height: 800 }
  const fetch = vi.fn(async (url: string) =>
    new Response(JSON.stringify(String(url).includes('page=6') ? { page: null, boxes: [] } : found)),
  )
  vi.stubGlobal('fetch', fetch)
  const onShow = renderCard()

  fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))

  await waitFor(() => expect(onShow).toHaveBeenCalled())
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(onShow.mock.calls[0][0]).toMatchObject({ page: 5, source: { page: 5 } })
})
