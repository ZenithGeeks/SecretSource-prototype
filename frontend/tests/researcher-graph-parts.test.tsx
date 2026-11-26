/** The graph's small parts: the segmented control, the two legends, the detail panels and fitReadable. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type cytoscape from 'cytoscape'
import { toast } from 'sonner'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { fitReadable } from '../src/lib/graphFit'
import type { KnowledgeGraph, PaperEdge } from '../src/lib/researcher'
import { GraphClaimDetail, GraphPairDetail } from '../src/roles/researcher/components/GraphDetail'
import { GraphClaimsLegend, GraphPapersLegend, type LegendColors } from '../src/roles/researcher/components/GraphLegend'
import { GraphSegmented } from '../src/roles/researcher/components/GraphSegmented'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GraphSegmented', () => {
  test('checks the chosen option and reports a click on another', () => {
    const onChange = vi.fn()
    render(
      <GraphSegmented
        label="Mode"
        value="a"
        options={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }]}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  test('only the checked option is a tab stop, and the arrow keys move the choice and the focus', () => {
    const onChange = vi.fn()
    render(
      <GraphSegmented
        label="Mode"
        value="a"
        options={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }, { key: 'c', label: 'Gamma' }]}
        onChange={onChange}
      />,
    )
    const [alpha, beta, gamma] = screen.getAllByRole('radio')
    expect([alpha, beta, gamma].map((radio) => radio.tabIndex)).toEqual([0, -1, -1])

    fireEvent.keyDown(alpha, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('b')
    expect(beta).toHaveFocus()
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' }) // wraps to the last one
    expect(onChange).toHaveBeenLastCalledWith('c')
    expect(gamma).toHaveFocus()
    fireEvent.keyDown(alpha, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('b')
    fireEvent.keyDown(alpha, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('c')

    onChange.mockClear()
    fireEvent.keyDown(alpha, { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

const COLORS: LegendColors = {
  supports: '#0a0', refutes: '#a00', insufficient: '#aa0', inkMuted: '#666', accent: '#80a', border: '#ddd',
}

describe('graph legends', () => {
  test('the claims legend names claim colours and edge styles', () => {
    render(<GraphClaimsLegend colors={COLORS} notIndexed={0} />)
    for (const text of ['Claim', 'Source contradicts', 'Source is silent', 'Not checked', 'Source backs it', 'Edge', 'backs it', 'contradicts', 'origin']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.queryByText(/not in a public index/)).toBeNull()
  })

  test('the claims legend counts works missing from a public index', () => {
    render(<GraphClaimsLegend colors={COLORS} notIndexed={3} />)
    expect(screen.getByText(/3 not in a public index/)).toBeInTheDocument()
  })

  test('the papers legend lists clusters, cycling colours, and the link styles', () => {
    render(<GraphPapersLegend colors={COLORS} clusters={['Analysed', 'Cited', 'Extra']} clusterColors={['#111', '#222']} notIndexed={1} />)
    for (const text of ['Analysed', 'Cited', 'Extra', 'cite the same works', 'more in common', 'one cites the other']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByText(/1 not in a public index/)).toBeInTheDocument()
  })
})

const paper = (id: string, label: string, extra: Record<string, string> = {}) =>
  ({ id, kind: 'paper', label, year: '’21', cluster: 'Cited', indexed: 'yes', index: 'arXiv', ...extra }) as KnowledgeGraph['nodes'][number]

const GRAPH: KnowledgeGraph = {
  clusters: ['Analysed', 'Cited'],
  nodes: [
    paper('a:1', 'ColBERT'),
    paper('a:2', 'BEIR', { year: '' }),
    paper('a:3', 'Lost paper', { indexed: 'no' }),
    paper('a:4', 'Unnamed index', { index: '' }),
    paper('a:5', 'No lookup', { indexed: '' }),
    { id: 'c:1', kind: 'claim', label: 'Late interaction wins.' },
    { id: 'c:2', kind: 'claim', label: 'Only claim with no edges.' },
    { id: 'c:3', kind: 'claim', label: 'Silent and backed.' },
    { id: 'c:4', kind: 'claim', label: 'Backed only.' },
    { id: 'c:5', kind: 'claim', label: 'Unchecked only.' },
  ],
  edges: [
    { id: 'e1', source: 'a:1', target: 'c:1', relation: 'asserts', quote: 'We show it.', page: 'p. 3' },
    { id: 'e2', source: 'a:2', target: 'c:1', relation: 'contradicts', quote: 'It does not.', page: 'p. 9' },
    { id: 'e3', source: 'a:3', target: 'c:1', relation: 'backs', quote: 'It does.' },
    { id: 'e4', source: 'a:4', target: 'c:1', relation: 'silent' },
    { id: 'e5', source: 'a:5', target: 'c:1', relation: 'unchecked', reason: 'no_full_text' },
    { id: 'e6', source: 'ghost', target: 'c:1', relation: 'backs', quote: 'From nowhere.' },
    { id: 'e7', source: 'a:1', target: 'c:3', relation: 'silent' },
    { id: 'e8', source: 'a:2', target: 'c:3', relation: 'backs' },
    { id: 'e9', source: 'a:2', target: 'c:4', relation: 'backs' },
    { id: 'e10', source: 'a:2', target: 'c:5', relation: 'unchecked' },
  ],
  paperEdges: [],
}

describe('GraphClaimDetail', () => {
  const open = (claimId: string, onClose = vi.fn()) =>
    render(<GraphClaimDetail graph={GRAPH} claimId={claimId} onClose={onClose} />)

  test('shows the sentence, its origin with quote and page, and what each other paper says', () => {
    open('c:1')
    expect(screen.getByRole('complementary', { name: 'Claim detail' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Late interaction wins.' })).toBeInTheDocument()
    expect(screen.getByText('ColBERT ’21')).toBeInTheDocument()
    expect(screen.getByText(/We show it\./)).toBeInTheDocument()
    expect(screen.getByText('p. 3')).toBeInTheDocument()
    expect(screen.getByText('What the other papers say')).toBeInTheDocument()
    expect(screen.getByText('BEIR')).toBeInTheDocument()
    expect(screen.getByText('ghost')).toBeInTheDocument()
  })

  test('says where a cited work was found, or that no index knew it', () => {
    open('c:1')
    expect(screen.getByText('Not found in a public index')).toBeInTheDocument()
    expect(screen.getByText('Found in arXiv')).toBeInTheDocument()
    expect(screen.getByText('Found in a public index')).toBeInTheDocument()
  })

  test('says why a check could not run', () => {
    open('c:1')
    expect(screen.getByText(/couldn't check:/)).toBeInTheDocument()
  })

  test('warns when a contradicted claim has a single origin', () => {
    open('c:1')
    expect(screen.getByText(/the claim inherits/)).toBeInTheDocument()
  })

  test('a claim with no edges has no recorded origin and no other-papers heading', () => {
    open('c:2')
    expect(screen.getByText('No origin recorded.')).toBeInTheDocument()
    expect(screen.queryByText('What the other papers say')).toBeNull()
    expect(screen.queryByText(/the claim inherits/)).toBeNull()
  })

  test.each([
    ['c:3', 'silent'],
    ['c:4', 'backed'],
    ['c:5', 'unchecked'],
  ])('reads the standing of %s (%s) without a warning', (id) => {
    open(id)
    expect(screen.getByRole('complementary', { name: 'Claim detail' })).toBeInTheDocument()
    expect(screen.queryByText(/the claim inherits/)).toBeNull()
  })

  test('renders nothing for an unknown id or a paper id', () => {
    const { container, rerender } = open('nope')
    expect(container).toBeEmptyDOMElement()
    rerender(<GraphClaimDetail graph={GRAPH} claimId="a:1" onClose={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('Close calls onClose', () => {
    const onClose = vi.fn()
    open('c:1', onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('Copy evidence puts the claim and the other papers quotes on the clipboard, then shows Copied', async () => {
    open('c:1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy evidence' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy evidence' })).toHaveAttribute('title', 'Copied'))
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)?.[0] as string
    expect(text).toContain('Late interaction wins.')
    expect(text).toContain('BEIR — contradicts: "It does not."')
    expect(text).toContain('Lost paper ’21 — backs: "It does."')
  })

  test('Copy evidence says so when the clipboard is not available', async () => {
    const error = vi.spyOn(toast, 'error')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('blocked'))
    open('c:1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy evidence' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not copy. Select the text and copy it by hand.'))
    expect(screen.getByRole('button', { name: 'Copy evidence' })).toHaveAttribute('title', 'Copy evidence')
  })

  test('Copied goes back to Copy evidence after a moment', async () => {
    vi.useFakeTimers()
    open('c:1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy evidence' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Copy evidence' })).toHaveAttribute('title', 'Copied')
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByRole('button', { name: 'Copy evidence' })).toHaveAttribute('title', 'Copy evidence')
  })
})

const EDGE: PaperEdge = {
  id: 'p1', a: 'a:1', b: 'a:3', similarity: 0.8, sharedPassages: 2, citations: 3, cites: false,
  passages: [
    { paper: 'ColBERT', page: 'p. 2', quote: 'First quote' },
    { paper: 'Lost paper', page: '', quote: 'Second quote' },
  ],
}

describe('GraphPairDetail', () => {
  const open = (edge: PaperEdge, onClose = vi.fn()) =>
    render(<GraphPairDetail graph={GRAPH} edge={edge} onClose={onClose} />)

  test('names the pair, the shared works, the missing index and the passages', () => {
    open(EDGE)
    expect(screen.getByRole('heading')).toHaveTextContent('ColBERT ’21 ↔ Lost paper ’21')
    expect(screen.getByText('3 cited works in common')).toBeInTheDocument()
    expect(screen.getByText('Lost paper ’21 was not found in a public index')).toBeInTheDocument()
    expect(screen.getByText('ColBERT · p. 2')).toBeInTheDocument()
    expect(screen.getByText('Lost paper')).toBeInTheDocument()
    expect(screen.getByText(/First quote/)).toBeInTheDocument()
    expect(screen.queryByText(/contradicted/)).toBeNull()
  })

  test('uses the singular for one shared work and one citing claim', () => {
    open({ ...EDGE, citations: 1 })
    expect(screen.getByText('1 cited work in common')).toBeInTheDocument()
  })

  test.each([
    [1, 'One cites the other · 1 claim cites it'],
    [4, 'One cites the other · 4 claims cite it'],
  ])('a citation link with %i citations reads "%s"', (citations, text) => {
    open({ ...EDGE, cites: true, citations })
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  test.each([
    [1, '1 claim is contradicted'],
    [2, '2 claims are contradicted'],
  ])('counts %i contradicted claims', (contradicted, text) => {
    open({ ...EDGE, contradicted })
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByText('Refutes')).toBeInTheDocument()
  })

  test('falls back to the id for a paper the graph does not know, and says when no passages are indexed', () => {
    open({ ...EDGE, a: 'a:9', passages: [] })
    expect(screen.getByRole('heading')).toHaveTextContent('a:9 ↔ Lost paper ’21')
    expect(screen.getByText('No shared passages indexed for this pair yet.')).toBeInTheDocument()
  })

  test('Close calls onClose', () => {
    const onClose = vi.fn()
    open(EDGE, onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('each paper gets its own link that opens in a new tab', () => {
    open(EDGE)
    const links = screen.getAllByRole('link', { name: /in a new tab/ })
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      expect.stringContaining('analysis=1'),
      expect.stringContaining('analysis=3'),
    ])
    expect(links.every((a) => a.getAttribute('target') === '_blank')).toBe(true)
  })
})

describe('fitReadable', () => {
  const core = (zoom: number, destroyed = false) =>
    ({
      destroyed: () => destroyed,
      resize: vi.fn(),
      fit: vi.fn(),
      zoom: vi.fn((arg?: unknown) => (arg === undefined ? zoom : undefined)),
      width: () => 400,
      height: () => 200,
    }) as unknown as cytoscape.Core & { resize: ReturnType<typeof vi.fn>; zoom: ReturnType<typeof vi.fn> }

  test('does nothing once the graph is destroyed', () => {
    const cy = core(1, true)
    fitReadable(cy)
    expect(cy.resize).not.toHaveBeenCalled()
  })

  test('leaves a readable zoom alone', () => {
    const cy = core(1)
    fitReadable(cy)
    expect(cy.zoom).toHaveBeenCalledTimes(1)
  })

  test('raises a zoom below 0.9 to 0.9, centred', () => {
    const cy = core(0.5)
    fitReadable(cy)
    expect(cy.zoom).toHaveBeenLastCalledWith({ level: 0.9, renderedPosition: { x: 200, y: 100 } })
  })
})
