/**
 * The redesigned Researcher graph and Ask the field screens (Figma: Graph · Claims, Graph ·
 * Papers, Ask the field). The canvas needs a real browser, so react-cytoscapejs is mocked and the
 * tests are about the React around it: the Papers filter is one exclusive control, the zoom stack
 * is labelled and has no fullscreen button, and the consensus count tiles add up to the table.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import type { FieldConsensus as ConsensusData, KnowledgeGraph } from '../src/lib/researcher'
import { FieldConsensus } from '../src/roles/researcher/screens/FieldConsensus'
import { Graph } from '../src/roles/researcher/screens/Graph'

vi.mock('react-cytoscapejs', () => ({ default: () => <div data-testid="cytoscape-canvas" /> }))

const GRAPH: KnowledgeGraph = {
  clusters: ['Analysed', 'Cited'],
  nodes: [
    { id: 'a:1', kind: 'paper', label: 'ColBERT', year: '’20', cluster: 'Analysed', indexed: 'yes', index: 'arXiv' },
    { id: 'a:2', kind: 'paper', label: 'BEIR', year: '’21', cluster: 'Cited', indexed: 'yes', index: 'arXiv' },
    { id: 'c:1', kind: 'claim', label: 'Late interaction beats single-vector retrieval.' },
  ],
  edges: [
    { id: 'e1', source: 'a:1', target: 'c:1', relation: 'asserts' },
    { id: 'e2', source: 'a:2', target: 'c:1', relation: 'contradicts', quote: 'It does not.' },
  ],
  paperEdges: [
    { id: 'p1', a: 'a:1', b: 'a:2', similarity: 0.8, sharedPassages: 0, citations: 3, cites: true, passages: [] },
  ],
}

const row = (paper: string, verdict: ConsensusData['rows'][number]['verdict'], i: number) => ({
  paper, cite: 'Someone et al. · 2022', verdict, quote: `Quote ${i}`, claim: 'A claim', analysis: `an-${i}`, claimIndex: i,
})

const CONSENSUS: ConsensusData = {
  question: 'does it generalize?',
  supports: 3,
  refutes: 1,
  silent: 2,
  span: '2019–2023',
  note: 'From 2 claims in your analysed papers that match the question.',
  unlisted: 0,
  rows: [
    row('PLAID', 'supports', 1), row('ColBERTv2', 'supports', 2), row('ColBERT', 'supports', 3),
    row('DPR', 'refutes', 4), row('BEIR', 'insufficient', 5), row('MS MARCO', 'insufficient', 6),
  ],
}

vi.mock('../src/lib/useResearcher', () => ({
  useKnowledgeGraph: () => ({ data: GRAPH, isError: false }),
  useFieldConsensus: () => ({ data: CONSENSUS, isError: false, isPending: false }),
}))

beforeAll(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('Graph · Papers filter', () => {
  test('is one segmented control with three exclusive options', () => {
    render(<Graph onOpenAnalysis={() => undefined} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))

    const group = screen.getByRole('radiogroup', { name: 'Papers view filter' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((o) => o.textContent)).toEqual(['All 2 papers', 'Strong links only', 'Citations'])
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])

    fireEvent.click(within(group).getByRole('radio', { name: 'Citations' }))
    expect(within(group).getAllByRole('radio').map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
  })
})

describe('Graph · zoom stack', () => {
  test('zoom in, zoom out and fit have labels, and there is no fullscreen button', () => {
    render(<Graph onOpenAnalysis={() => undefined} />)
    for (const name of ['Zoom in', 'Zoom out', 'Fit to view']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /fullscreen/i })).toBeNull()
  })

  test('an insight tile is a pressable filter', () => {
    render(<Graph onOpenAnalysis={() => undefined} />)
    const tile = screen.getByRole('button', { name: /claims rest on a single source/ })
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(tile)
    expect(tile).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Ask the field', () => {
  test('the count tiles add up to the rows in the table', () => {
    render(<FieldConsensus onOpenAnalysis={() => undefined} />)
    // Rows where the paper is silent are folded behind "Show them"; open them to see them all.
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))

    const total = screen.getAllByTestId('consensus-count').reduce((sum, el) => sum + Number(el.textContent), 0)
    expect(total).toBe(6)
    expect(screen.getAllByTestId('consensus-row')).toHaveLength(total)
  })

  test('has one Ask button and none of the dropped actions', () => {
    render(<FieldConsensus onOpenAnalysis={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
    expect(screen.queryByText(/Save this question/)).toBeNull()
    expect(screen.queryByText(/related-work paragraph/)).toBeNull()
    expect(screen.queryByText('CSV')).toBeNull()
  })
})
