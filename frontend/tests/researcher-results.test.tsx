/** The researcher's Results and Running screens: count tiles that filter, one Export menu, one Stop action. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verdictCountLabel } from '../src/lib/claims'

const cite = (title: string) => ({ title, authors: ['Ioffe'], year: '2015', doi: `10/${title}`, arxiv: '', url: '' })
const verdict = (kind: 'supports' | 'refutes' | 'insufficient', source: string) => ({
  verdict: kind,
  quote: `${source} says so.`,
  reasoning: `Because ${source}.`,
  source,
  evidence: [],
  pages: [],
})

const data = vi.hoisted(() => ({ analysis: {} as Record<string, unknown> }))

vi.mock('../src/lib/useAnalysis', () => ({
  useAnalysis: () => ({ data: data.analysis, isPending: false, isError: false }),
}))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('../src/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/csv')>()),
  downloadText: vi.fn(),
}))

import { AnalysisView } from '../src/components/AnalysisView'
import { downloadText } from '../src/lib/csv'

function finished() {
  return {
    id: 'a1', paper: 'p.pdf', file: 'p.pdf', status: 'done', stages: [],
    claims: [
      { claim: 'Refuted claim.', citations: [cite('r')], verdicts: [verdict('refutes', 'r.pdf')], unchecked: [] },
      { claim: 'Silent claim.', citations: [cite('s')], verdicts: [verdict('insufficient', 's.pdf')], unchecked: [] },
      { claim: 'Backed claim one.', citations: [cite('b1')], verdicts: [verdict('supports', 'b1.pdf')], unchecked: [] },
      { claim: 'Backed claim two.', citations: [cite('b2')], verdicts: [verdict('supports', 'b2.pdf')], unchecked: [] },
    ],
  }
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalysisView id="a1" />
    </QueryClientProvider>,
  )
}

describe('researcher results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    data.analysis = finished()
  })

  it('shows a count tile per verdict and filters the claims when one is clicked', () => {
    renderView()
    const tile = (kind: 'refutes' | 'insufficient' | 'supports' | 'unchecked', n: number) =>
      screen.getByRole('button', { name: verdictCountLabel(kind, n) })

    expect(tile('refutes', 1)).toHaveAttribute('aria-pressed', 'false')
    expect(tile('insufficient', 1)).toBeInTheDocument()
    expect(tile('supports', 2)).toHaveTextContent('back it')
    expect(tile('unchecked', 0)).toBeInTheDocument()
    // Nothing is selected to begin with, so every claim is listed.
    for (const text of ['Refuted claim.', 'Silent claim.', 'Backed claim one.', 'Backed claim two.']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }

    fireEvent.click(tile('supports', 2))
    expect(tile('supports', 2)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Backed claim one.')).toBeInTheDocument()
    expect(screen.getByText('Backed claim two.')).toBeInTheDocument()
    expect(screen.queryByText('Refuted claim.')).not.toBeInTheDocument()
    expect(screen.queryByText('Silent claim.')).not.toBeInTheDocument()

    fireEvent.click(tile('supports', 2))
    expect(screen.getByText('Refuted claim.')).toBeInTheDocument()
  })

  it('puts copy and CSV in one Export menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderView()

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Copy as markdown', 'Download CSV'])

    fireEvent.click(screen.getByRole('menuitem', { name: 'Download CSV' }))
    expect(downloadText).toHaveBeenCalledWith('claims.csv', expect.stringContaining('Refuted claim.'), expect.any(String))

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Refuted claim.')))
  })

  it('shows results so far while a run is going, with no stop or export action', async () => {
    data.analysis = { ...finished(), status: 'running', stages: [{ stage: 'extracting', at: 1 }] }
    renderView()

    expect(await screen.findByText('Results so far')).toBeInTheDocument()
    // There is no stop endpoint; deleting is the only thing the gateway offers, and it is not a stop.
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })
})
