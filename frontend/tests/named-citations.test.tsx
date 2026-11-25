/** A claim about the paper's own work cites a benchmark or model only to name it. Those citations
 * are not checked, and the claim is "Names a tool or dataset", not "Not checked" (#475). */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ClaimCard } from '../src/components/ClaimCard'
import type { Claim } from '../src/lib/api'
import { countsOf, ranked, standingOf } from '../src/lib/claims'

const mmvet = { title: 'MM-Vet', authors: ['Yu'], year: '2023', doi: '', arxiv: '2308.02490', url: '' }
const llava = { title: 'Visual instruction tuning', authors: ['Liu'], year: '2023', doi: '', arxiv: '2304.08485', url: '' }

const ownResult: Claim = {
  claim: 'On MMVet, Qwen2-VL-72B achieves 74.0.',
  citations: [mmvet],
  named: ['2308.02490'],
}

describe('a claim that only names what it uses', () => {
  it('has its own standing, after the verdicts and before "no citation"', () => {
    const silent: Claim = { claim: 'LVLMs improved fast.', citations: [llava], verdicts: [], unchecked: [] }
    const uncited: Claim = { claim: 'Nothing cited.', citations: [] }

    expect(standingOf(ownResult)).toBe('named')
    expect(ranked([uncited, ownResult, silent]).map(({ standing }) => standing)).toEqual([
      'unchecked',
      'named',
      'uncited',
    ])
    expect(countsOf(ranked([ownResult])).named).toBe(1)
  })

  it('is still waiting when only some of its citations are named', () => {
    expect(standingOf({ ...ownResult, citations: [mmvet, llava] })).toBe('unchecked')
  })

  it('says on the card why the cited work was not checked', () => {
    render(<ClaimCard claim={ownResult} index={0} standing="named" />)

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('Names a tool or dataset')).toBeInTheDocument()
    expect(screen.getByText(/only names this as something the paper used/)).toBeInTheDocument()
    expect(screen.queryByText(/verification did not run/)).not.toBeInTheDocument()
  })
})
