/** The crop a verdict was read off comes first on the claim card, and opening it outlines its
 * box on the page (SCRUM-81). A verdict from the passages keeps its quote and page chips. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ClaimCard } from '../src/components/ClaimCard'
import type { Target } from '../src/components/PageViewer'
import type { Claim, Source, Verdict } from '../src/lib/api'

const cited = { title: 'ColBERT', authors: ['Khattab'], year: '2020', doi: '10.1145/3397271.3401075', arxiv: '', url: '' }

const region: Source = { page: 8, boxes: [{ x0: 83, y0: 546, x1: 264, y1: 635 }], page_width: 612, page_height: 792 }

const figure = {
  page: 3,
  score: 9.1,
  kind: 'figure' as const,
  label: 'Figure 3',
  caption: 'Figure 3: The general architecture of ColBERT.',
  image: '/papers/figures/colbert/figure-3.png',
  region: { ...region, page: 3 },
}
const table = {
  page: 8,
  score: 8.7,
  kind: 'table' as const,
  label: 'Table 3',
  caption: 'Table 3: Results on TREC CAR.',
  image: '/papers/figures/colbert/table-3.png',
  region,
}

function verdict(extra: Partial<Verdict> = {}): Verdict {
  return {
    verdict: 'supports',
    quote: '',
    reasoning: 'BM25 + ColBERT reaches 31.3 MAP.',
    source: 'colbert.pdf',
    cited: '10.1145/3397271.3401075',
    evidence: [],
    pages: [figure, table],
    ...extra,
  }
}

function claimCard(v: Verdict, onShow = vi.fn<(target: Target) => void>()) {
  const claim: Claim = { claim: 'ColBERT reaches 31.3 MAP on TREC CAR.', citations: [cited], verdicts: [v], unchecked: [] }
  render(<ClaimCard claim={claim} index={0} standing="supports" onShow={onShow} />)
  fireEvent.click(screen.getByRole('button', { expanded: false })) // a backed claim starts collapsed
  return onShow
}

function cropButtons() {
  return screen.getAllByRole('button', { name: /^Show .* on its page/ })
}

describe('the crops on the claim card', () => {
  it('puts the table the verdict was read off first and says so', () => {
    claimCard(verdict({ verdict_from: 'figure', judged_figure: 'table-3.png' }))

    expect(cropButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Show Table 3 on its page in ColBERT',
      'Show Figure 3 on its page in ColBERT',
    ])
    expect(screen.getByText('The verdict rests on this table')).toBeInTheDocument()
  })

  it('puts the figure the verdict was read off first and says so', () => {
    claimCard(verdict({ verdict_from: 'figure', judged_figure: 'figure-3.png' }))

    expect(cropButtons()[0]).toHaveAccessibleName('Show Figure 3 on its page in ColBERT')
    expect(screen.getByText('The verdict rests on this figure')).toBeInTheDocument()
  })

  it('opens the crop on its page with its box outlined', () => {
    const onShow = claimCard(verdict({ verdict_from: 'figure', judged_figure: 'table-3.png' }))

    fireEvent.click(cropButtons()[0])

    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ paper: 'colbert.pdf', page: 8, source: region }))
  })

  it('gives a cropped table no chip as well, since its picture already opens it', () => {
    claimCard(verdict())

    expect(screen.queryByRole('button', { name: 'Table 3 in the cited paper' })).not.toBeInTheDocument()
  })

  it('opens the chip of a table without a crop with the box outlined too', () => {
    const onShow = claimCard(verdict({ pages: [{ ...table, image: undefined }] }))

    fireEvent.click(screen.getByRole('button', { name: 'Table 3 in the cited paper' }))

    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ page: 8, source: region }))
  })

  it('opens a crop from an older analysis on its page, unmarked', () => {
    const onShow = claimCard(verdict({ pages: [{ ...table, region: undefined }] }))

    fireEvent.click(cropButtons()[0])

    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ page: 8, source: null }))
  })

  it('keeps match order and marks no crop for a verdict from the passages', () => {
    claimCard(
      verdict({
        verdict_from: 'text',
        quote: 'BM25 + ColBERT reaches a MAP of 31.3.',
        evidence: [{ text: 'BM25 + ColBERT reaches a MAP of 31.3.', page: 8, start: 0, end: 36, score: 1 }],
      }),
    )

    expect(cropButtons()[0]).toHaveAccessibleName('Show Figure 3 on its page in ColBERT')
    expect(screen.queryByText(/The verdict rests on this/)).not.toBeInTheDocument()
    // The quote, and the retrieved passage under More evidence.
    expect(screen.getAllByText(/BM25 \+ ColBERT reaches a MAP of 31\.3\./)).toHaveLength(2)
  })
})
