/** One name for the silent verdict, one place for the check counts, and "Cited work" for any
 * citation (#479). */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AnalysisHeader } from '../src/components/AnalysisHeader'
import { AnalysisProgress } from '../src/components/AnalysisProgress'
import { ClaimCard } from '../src/components/ClaimCard'
import type { Analysis, Claim, Stage } from '../src/lib/api'

const vicuna = { title: 'Vicuna', authors: ['Chiang'], year: '2023', doi: '', arxiv: '', url: 'https://lmsys.org/blog' }
const llava = { title: 'Visual instruction tuning', authors: ['Liu'], year: '2023', doi: '', arxiv: '2304.08485', url: '' }

const claim: Claim = {
  claim: 'LVLMs follow a visual encoder, connector, LLM design.',
  citations: [llava, vicuna],
  verdicts: [],
  unchecked: [{ source: 'https://lmsys.org/blog', reason: 'web-source', message: '' }],
}

const stages = [
  { stage: 'extracted', claims: 1 },
  { stage: 'planned', checks: 2, sources: 2 },
  { stage: 'verified', claim: 0, source: '2304.08485', verdict: 'insufficient' },
  { stage: 'failed', claim: 0, source: 'https://lmsys.org/blog', reason: 'web-source' },
  { stage: 'done' },
] as Stage[]

describe('the analysis page wording', () => {
  it('says "silent" in the summary line, as the tiles and badges do', () => {
    render(<AnalysisProgress stages={stages} claims={[claim]} status="done" />)

    expect(screen.getByText(/1 silent/)).toBeInTheDocument()
    expect(screen.queryByText(/not enough evidence/)).not.toBeInTheDocument()
  })

  it('leaves the check count to the summary line', () => {
    const analysis = { id: 'a1', paper: 'p.pdf', status: 'done', stages, claims: [claim] } as unknown as Analysis

    render(<AnalysisHeader analysis={analysis} />)

    expect(screen.getByText('1 claim')).toBeInTheDocument()
    expect(screen.queryByText(/citations? checked/)).not.toBeInTheDocument()
  })

  it('calls a web page a cited work, not a cited paper', () => {
    render(<ClaimCard claim={claim} index={0} standing="unchecked" />)

    expect(screen.getAllByText('Cited work').length).toBeGreaterThan(0)
    expect(screen.queryByText('Cited paper')).not.toBeInTheDocument()
  })
})
