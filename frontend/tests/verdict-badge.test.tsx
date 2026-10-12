/** The one verdict pill: a dot and the shared words for every kind, and the count labels that
 * agree with their number. Colour never carries the meaning alone. */

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { verdictCountLabel } from '../src/lib/claims'
import type { Standing } from '../src/lib/claims'
import { VerdictBadge } from '../src/components/ui'

const WORDS: Record<Standing, string> = {
  refutes: 'Source contradicts',
  insufficient: 'Source is silent',
  supports: 'Source backs it',
  unchecked: 'Not checked',
  uncited: 'No citation',
}

for (const [kind, words] of Object.entries(WORDS) as [Standing, string][]) {
  test(`VerdictBadge ${kind} shows a dot and the words "${words}"`, () => {
    render(<VerdictBadge verdict={kind} />)
    const pill = screen.getByText(words).closest('[data-verdict]')
    expect(pill).toHaveAttribute('data-verdict', kind)
    expect(pill).toHaveTextContent(words)
    expect(pill?.querySelector('[data-testid="verdict-dot"]')).toBeInTheDocument()
  })
}

test('count labels agree with their number', () => {
  expect(verdictCountLabel('refutes', 1)).toBe('1 contradicts')
  expect(verdictCountLabel('refutes', 4)).toBe('4 contradict')
  expect(verdictCountLabel('insufficient', 4)).toBe('4 silent')
  expect(verdictCountLabel('supports', 1)).toBe('1 backs it')
  expect(verdictCountLabel('supports', 3)).toBe('3 back it')
  expect(verdictCountLabel('unchecked', 3)).toBe('3 not checked')
})
