import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({
  analysis: {
    id: 'analysis-7', paper: 'essay.pdf', status: 'done', file: 'essay.pdf',
    claims: [{
      claim: 'The source supports this statement.', citations: [],
      verdicts: [{ verdict: 'supports', quote: 'Evidence supports the claim.', reasoning: 'The source agrees.', source: 'source.pdf', evidence: [], pages: [] }],
      unchecked: [], sentence: 'This statement is in the essay.',
      source: { page: 4, boxes: [{ x0: 10, y0: 20, x1: 30, y1: 40 }], page_width: 100, page_height: 200 },
    }],
    stages: [],
  },
}))

vi.mock('../src/lib/useAnalysis', () => ({ useAnalysis: () => ({ data: data.analysis, isPending: false, isError: false }) }))
vi.mock('../src/components/PageViewer', () => ({
  PageViewer: ({ target }: { target: { label: string; source: { page: number } | null; verdict?: string } }) => (
    <div data-testid="shared-page-viewer" data-page={target.source?.page} data-verdict={target.verdict}>{target.label}</div>
  ),
}))

import { AnalysisView } from '../src/components/AnalysisView'

describe('teacher presentation of the shared analysis workflow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the selected claim in the submission PDF with its verdict color and keeps teacher controls in the shared claim', () => {
    render(
      <AnalysisView
        id="analysis-7"
        presentation="teacher"
        openPaperOnLoad
        renderClaimActions={() => <button type="button">Professor result</button>}
      />,
    )

    const claim = screen.getByText('The source supports this statement.')
    const originalPdf = screen.getByTestId('shared-page-viewer')
    expect(originalPdf).toHaveTextContent('Claim 1 in this paper')
    fireEvent.click(screen.getByRole('button', { name: /The source supports this statement/ }))
    const pdf = screen.getByTestId('shared-page-viewer')
    expect(pdf).toHaveAttribute('data-page', '4')
    expect(pdf).toHaveAttribute('data-verdict', 'supports')
    expect(pdf).toHaveTextContent('Claim 1 in the submission')
    expect(pdf.compareDocumentPosition(claim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Professor result' })).toBeInTheDocument()
  })

  it('shows the Figma PDF, Copy All, and CSV toolbar for Teacher analysis', () => {
    render(<AnalysisView id="analysis-7" presentation="teacher" openPaperOnLoad />)

    expect(screen.getByRole('button', { name: 'Copy all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument()
  })
})
