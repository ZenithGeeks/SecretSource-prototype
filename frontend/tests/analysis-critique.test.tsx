/** The analysis page says which unit each count is in, names the work a verdict is about, and
 * keeps the other cited works to one line each until opened (#856). */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AnalysisProgress } from '../src/components/AnalysisProgress'
import { ClaimCard } from '../src/components/ClaimCard'
import type { Claim, Stage, Verdict } from '../src/lib/api'

const kotonya = { title: 'Explainable automated fact-checking', authors: ['Neema Kotonya', 'Francesca Toni'], year: '2020', doi: '', arxiv: '2011.03870', url: '' }
const wu = { title: 'DTCA', authors: ['Lianwei Wu'], year: '2020', doi: '', arxiv: '2004.00001', url: '' }

const verdict = (cited: string, kind: Verdict['verdict'], quote: string, reasoning: string) =>
  ({ cited, source: `${cited}.pdf`, verdict: kind, quote, reasoning, evidence: [], pages: [] }) as unknown as Verdict

const claim: Claim = {
  claim: 'Explanations must be faithful to the model.',
  sentence: 'Explanations must be faithful to the model.',
  citations: [kotonya, wu],
  verdicts: [
    verdict('2011.03870', 'insufficient', '', 'The source never says explanations must be faithful.'),
    verdict('2004.00001', 'supports', 'Faithful explanations matter.', 'It says so.'),
  ],
  unchecked: [],
}

describe('the analysis page after the critique', () => {
  it('says the finished line counts citation checks, not claims', () => {
    const stages = [
      { stage: 'extracted', claims: 1 },
      { stage: 'planned', checks: 2, sources: 2 },
      { stage: 'verified', claim: 0, source: '2011.03870', verdict: 'insufficient' },
      { stage: 'verified', claim: 0, source: '2004.00001', verdict: 'supports' },
      { stage: 'done' },
    ] as Stage[]

    render(<AnalysisProgress stages={stages} claims={[claim]} status="done" />)

    expect(screen.getByText('2 citation checks: 1 backed, 1 silent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Details/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('names the cited work in the lead verdict and says when no passage matched', () => {
    render(<ClaimCard claim={claim} index={0} standing="insufficient" />)

    expect(screen.getAllByText(/Kotonya/).length).toBeGreaterThan(0)
    expect(screen.getByText("No exact passage matched. The judge's reading of the paper is below.")).toBeInTheDocument()
  })

  it('shows the claim once when it is the paper sentence word for word', () => {
    render(<ClaimCard claim={claim} index={0} standing="insufficient" />)

    // Only the quoted sentence remains; the identical paraphrase above it is dropped.
    expect(screen.queryByText(claim.claim)).not.toBeInTheDocument()
    expect(screen.getByText(`“${claim.sentence}”`)).toBeInTheDocument()
  })

  it('keeps another cited work to one line until it is opened', () => {
    render(<ClaimCard claim={claim} index={0} standing="insufficient" />)

    const row = screen.getByRole('button', { name: /Faithful explanations matter/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('It says so.')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(screen.getByText('It says so.')).toBeInTheDocument()
  })
})
