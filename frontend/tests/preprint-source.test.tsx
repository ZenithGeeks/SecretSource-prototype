/** A verdict read from a work's arXiv copy says so, on the claim card and in the Author
 * citation list (#424). */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ClaimCard } from '../src/components/ClaimCard'
import type { Claim, Verdict } from '../src/lib/api'
import { CitationCheckCard } from '../src/roles/author/components/CitationCheckCard'
import type { Citation, Draft } from '../src/types/draftCheck'

const cited = { title: 'KisMATH', authors: ['Saha'], year: '2025', doi: '10.1162/tacl.a.729', arxiv: '', url: '' }

function verdict(extra: Partial<Verdict> = {}): Verdict {
  return {
    verdict: 'refutes',
    quote: 'Math reasoning does not improve.',
    reasoning: 'The paper says the opposite.',
    source: 'kismath.pdf',
    cited: '10.1162/tacl.a.729',
    evidence: [],
    ...extra,
  }
}

function claimCard(v: Verdict) {
  const claim: Claim = { claim: 'KisMATH improves math reasoning.', citations: [cited], verdicts: [v], unchecked: [] }
  return render(<ClaimCard claim={claim} index={0} standing="refutes" />)
}

describe('the claim card', () => {
  it('says the verdict was checked against the arXiv preprint', () => {
    claimCard(verdict({ source_version: 'preprint', arxiv: '2507.11408' }))

    expect(screen.getByText(/checked against the arXiv preprint 2507\.11408/i)).toBeInTheDocument()
  })

  it('says nothing about a preprint for the publisher PDF', () => {
    claimCard(verdict())

    expect(screen.queryByText(/arXiv preprint/i)).not.toBeInTheDocument()
  })
})

const draft = {
  status: { checked: 1, counts: { supports: 0, insufficient: 0, refutes: 1, unavailable: 0, unchecked: 0 } },
  lastCheckedAt: null,
} as unknown as Draft

function citationList(extra: Partial<Citation> = {}) {
  const citation: Citation = {
    id: 'c1',
    key: 'saha2025',
    file: 'main.tex',
    line: 1,
    column: 1,
    sentence: 'KisMATH improves math reasoning \\cite{saha2025}.',
    claim: 'KisMATH improves math reasoning.',
    verdict: 'refutes',
    evidence: { passage: 'Math reasoning does not improve.', pdf: 'kismath.pdf', page: 3 },
    ...extra,
  }
  render(<CitationCheckCard draft={draft} citations={[citation]} selectedId={undefined} onSelect={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'All' }))
}

describe('the Author citation list', () => {
  it('says the citation was checked against the arXiv preprint', () => {
    citationList({ sourceVersion: 'preprint', arxiv: '2507.11408' })

    expect(screen.getByText(/checked against the arXiv preprint 2507\.11408/)).toBeInTheDocument()
  })

  it('says nothing about a preprint for the publisher PDF', () => {
    citationList()

    expect(screen.queryByText(/arXiv preprint/)).not.toBeInTheDocument()
  })
})
