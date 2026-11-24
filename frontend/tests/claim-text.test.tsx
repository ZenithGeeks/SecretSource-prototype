import { describe, expect, it } from 'vitest'

import { printedMarkers, printedRef, tidyClaim } from '../src/lib/claimText'

describe('tidyClaim', () => {
  it.each([
    ['Inspired by,,, Yuan et al. propose X.', 'Inspired by, Yuan et al. propose X.'],
    ['as shown in prior work ( , ) and later.', 'as shown in prior work and later.'],
    ['learned priors-.', 'learned priors.'],
    ['methods were proposed in-,,.', 'methods were proposed in.'],
    ['a  b ,  c .', 'a b, c.'],
    ['as shown in X ,. Then', 'as shown in X. Then'],
    ['as shown in X,.', 'as shown in X.'],
    ['It ends here..', 'It ends here.'],
  ])('tidies %j', (raw, shown) => {
    expect(tidyClaim(raw)).toBe(shown)
  })

  it('keeps an ellipsis', () => {
    expect(tidyClaim('Then... it stops.')).toBe('Then... it stops.')
  })

  it('leaves clean text and hyphenated words alone', () => {
    expect(tidyClaim('State-of-the-art models, e.g. BERT, improve recall.')).toBe('State-of-the-art models, e.g. BERT, improve recall.')
  })
})

describe('printedMarkers', () => {
  const markers = [
    { ref: 'b1', text: '7' },
    { ref: 'b2', text: '[8]' },
    { ref: 'b3', text: '(Lee, 2020)' },
  ]

  it('puts the printed number in square brackets', () => {
    expect(printedMarkers('See [b1].', markers)).toBe('See [7].')
  })

  it('keeps a marker that already starts with a bracket', () => {
    expect(printedMarkers('See [b2] and [b3].', markers)).toBe('See [8] and (Lee, 2020).')
  })

  it('uses only unambiguous text belonging to a single reference', () => {
    const box = { page: 1, x0: 2, y0: 3, x1: 4, y1: 5 }
    const entries = [
      { ref: 'b1', text: '7' },
      { ref: 'b1', text: '[7]' },
      { ref: 'b1', text: '[7]' },
      { ref: 'b1', text: '[7,8]' },
      { ref: 'b2', text: '[8–10]' },
      { ref: 'b3', text: '(Lee, 2020; Nye, 2021)', ...box },
      { ref: 'b4', text: '(Lee, 2020; Nye, 2021)', ...box },
      { ref: 'b5', text: '[11]' },
      { ref: 'b5', text: '[12]' },
      { ref: 'b6', text: '  ' },
    ]
    expect(printedMarkers('[b1] [b2] [b3] [b4] [b5] [b6]', entries)).toBe('[7] [b2] [b3] [b4] [b5] [b6]')
    expect(printedRef({ ref: 'b5' }, [...entries].reverse())).toBe('')
  })

  it('leaves an id the markers do not cover', () => {
    expect(printedMarkers('See [b9].', markers)).toBe('See [b9].')
  })

  it("gives a reference cited alone and in a group its own number, whichever comes last", () => {
    const grouped = { ref: 'b6', text: '[7,8]' }
    const alone = { ref: 'b6', text: '[7]' }
    expect(printedMarkers('See [b6].', [alone, grouped])).toBe('See [7].')
    expect(printedMarkers('See [b6].', [grouped, alone])).toBe('See [7].')
  })
})

describe('printedRef', () => {
  const markers = [{ ref: 'b1', text: '7' }]

  it('gives the printed number for a reference', () => {
    expect(printedRef({ ref: 'b1' }, markers)).toBe('[7]')
  })

  it('is empty for an unknown id, no id, or no markers', () => {
    expect(printedRef({ ref: 'b2' }, markers)).toBe('')
    expect(printedRef({}, markers)).toBe('')
    expect(printedRef({ ref: 'b1' })).toBe('')
  })
})
