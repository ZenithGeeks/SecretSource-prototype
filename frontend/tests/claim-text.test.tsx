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

  it('leaves an id the markers do not cover', () => {
    expect(printedMarkers('See [b9].', markers)).toBe('See [b9].')
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
