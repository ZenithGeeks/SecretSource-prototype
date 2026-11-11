/**
 * The Graph screen end to end. react-cytoscapejs needs a real canvas, so it is replaced by a
 * component that builds a headless Cytoscape core from the same props and hands it to the screen's
 * `cy` callback, the way the real one does. Events are then emitted on that core (tap, hover,
 * layoutstop), so the screen's own handlers run against real graph elements.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type cytoscape from 'cytoscape'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { KnowledgeGraph } from '../src/lib/researcher'
import { SETTINGS_DEFAULTS, updateSettings } from '../src/lib/settings'
import { Graph } from '../src/roles/researcher/screens/Graph'

type CytoscapeProps = {
  elements: { data: Record<string, unknown>; position?: { x: number; y: number } }[]
  stylesheet: { selector: string; style: Record<string, unknown> }[]
  layout: { name: string }
  cy: (cy: cytoscape.Core) => void
}

const h = vi.hoisted(() => ({
  graph: undefined as unknown,
  isError: false,
  refetch: vi.fn(),
  skipCy: false,
  cy: null as unknown,
  props: null as unknown,
  handlers: [] as unknown[][],
}))

vi.mock('cytoscape-cola', () => ({
  default: () => {
    throw new Error('already registered')
  },
}))

vi.mock('react-cytoscapejs', async () => {
  const { default: cytoscape } = await import('cytoscape')
  const { useEffect, useRef } = await import('react')
  return {
    default: function FakeCytoscape(props: CytoscapeProps) {
      const core = useRef<cytoscape.Core | null>(null)
      const elements = useRef<unknown>(null)
      useEffect(() => {
        if (!core.current) {
          core.current = cytoscape({ headless: true })
          const on = core.current.on.bind(core.current) as (...args: unknown[]) => cytoscape.Core
          core.current.on = ((...args: unknown[]) => {
            h.handlers.push(args)
            return on(...args)
          }) as typeof core.current.on
        }
        if (elements.current !== props.elements) {
          core.current.elements().remove()
          core.current.add(props.elements)
          elements.current = props.elements
        }
        h.cy = core.current
        h.props = props
        if (!h.skipCy) props.cy(core.current)
      })
      useEffect(() => () => core.current?.destroy(), [])
      return <div data-testid="cytoscape-canvas" />
    },
  }
})

vi.mock('../src/lib/useResearcher', () => ({
  useKnowledgeGraph: () => ({ data: h.graph, isError: h.isError, error: new Error('502: '), refetch: h.refetch }),
  useFieldConsensus: () => ({
    data: { question: 'q', supports: 0, refutes: 0, silent: 0, span: '', note: '', unlisted: 0, rows: [] },
    isError: false,
    isPending: false,
  }),
}))

const cy = () => h.cy as cytoscape.Core
const props = () => h.props as CytoscapeProps
const emit = (fn: () => void) => act(fn)

const paper = (id: string, label: string, extra: Record<string, string> = {}) =>
  ({ id, kind: 'paper', label, year: '’21', cluster: 'Analysed', indexed: 'yes', index: 'arXiv', ...extra }) as KnowledgeGraph['nodes'][number]

const GRAPH: KnowledgeGraph = {
  clusters: ['Analysed', 'Cited'],
  nodes: [
    paper('a:1', 'ColBERT'),
    paper('a:2', 'Retrieval models rock hard', { year: '' }),
    paper('a:3', 'Dense passage retrieval for open domain', { cluster: 'Cited', indexed: 'no' }),
    { id: 'c:1', kind: 'claim', label: 'Late interaction wins.' },
    { id: 'c:2', kind: 'claim', label: 'A claim with no edges.' },
    { id: 'c:3', kind: 'claim', label: 'Silent and backed.' },
    { id: 'c:4', kind: 'claim', label: 'Backed only.' },
    { id: 'c:5', kind: 'claim', label: 'Unchecked only.' },
    paper('a:long', 'Pneumonoultramicroscopic', { cluster: 'Cited' }),
    paper('a:late', 'Latest upload'),
  ],
  edges: [
    { id: 'e1', source: 'a:1', target: 'c:1', relation: 'asserts', quote: 'We show it.' },
    { id: 'e2', source: 'a:2', target: 'c:1', relation: 'contradicts', quote: 'It does not.' },
    { id: 'e3', source: 'a:3', target: 'c:3', relation: 'silent' },
    { id: 'e4', source: 'a:2', target: 'c:3', relation: 'backs' },
    { id: 'e5', source: 'a:2', target: 'c:4', relation: 'backs' },
    { id: 'e6', source: 'a:2', target: 'c:5', relation: 'unchecked' },
  ],
  paperEdges: [
    { id: 'p1', a: 'a:1', b: 'a:2', similarity: 0.8, sharedPassages: 0, citations: 3, cites: true, passages: [] },
    { id: 'p2', a: 'a:2', b: 'a:1', similarity: 0.2, sharedPassages: 0, citations: 1, cites: true, passages: [] },
    { id: 'p3', a: 'a:1', b: 'a:3', similarity: 0.6, sharedPassages: 0, citations: 2, cites: false, passages: [] },
  ],
}

const noop = () => undefined
const open = (extra: Partial<Parameters<typeof Graph>[0]> = {}) => render(<Graph onOpenAnalysis={noop} hideTabs {...extra} />)
const tile = (name: RegExp) => screen.getByRole('button', { name })
const hasClass = (id: string, cls: string) => cy().$id(id).hasClass(cls)

let systemDark = false
let mediaListener: ((e: { matches: boolean }) => void) | null = null
let resizeCallback: (() => void) | null = null

beforeEach(() => {
  h.graph = GRAPH
  h.isError = false
  h.skipCy = false
  h.handlers = []
  systemDark = false
  mediaListener = null
  resizeCallback = null
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  window.matchMedia = (() => ({
    get matches() {
      return systemDark
    },
    addEventListener: (_: string, listener: (e: { matches: boolean }) => void) => {
      mediaListener = listener
    },
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
  window.ResizeObserver = class {
    constructor(callback: () => void) {
      resizeCallback = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  vi.restoreAllMocks()
  updateSettings({ theme: SETTINGS_DEFAULTS.theme })
})

describe('Graph · loading, errors and empty', () => {
  test('shows a loading state, and keeps Ask open beside it', () => {
    h.graph = undefined
    open({ askPanel: <p>Ask panel</p> })
    expect(screen.getByText('Loading the graph…')).toBeInTheDocument()
    expect(screen.getByText('Ask panel')).toBeInTheDocument()
  })

  test('shows an error message without Ask, and Retry asks the gateway again', () => {
    h.isError = true
    open()
    expect(screen.getByText('The graph could not load')).toBeInTheDocument()
    expect(screen.getByText('the server did not answer (502)')).toBeInTheDocument()
    expect(screen.queryByText('Ask panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(h.refetch).toHaveBeenCalledTimes(1)
  })

  test('an error leaves Ask open', () => {
    h.isError = true
    open({ askPanel: <p>Ask panel</p> })
    expect(screen.getByText('The graph could not load')).toBeInTheDocument()
    expect(screen.getByText('Ask panel')).toBeInTheDocument()
  })

  test('a role with an empty-state message sees it instead of the canvas', () => {
    h.graph = { clusters: [], nodes: [], edges: [], paperEdges: [] }
    open({ emptyMessage: { title: 'Nothing analysed yet', hint: 'Upload a paper.' } })
    expect(screen.getByText('Nothing analysed yet')).toBeInTheDocument()
    expect(screen.queryByTestId('cytoscape-canvas')).toBeNull()
  })

  test('a role without one keeps the empty canvas', () => {
    h.graph = { clusters: [], nodes: [], edges: [], paperEdges: [] }
    open()
    expect(screen.getByTestId('cytoscape-canvas')).toBeInTheDocument()
    expect(screen.getByText('0 papers · 0 claims')).toBeInTheDocument()
  })
})

describe('Graph · claims view', () => {
  test('titles the view and counts papers and claims', () => {
    open()
    expect(screen.getByRole('heading', { name: 'What rests on what' })).toBeInTheDocument()
    expect(screen.getByText('5 papers · 5 claims')).toBeInTheDocument()
  })

  test('draws claims with their overall standing and papers sized by the claims they touch', () => {
    open()
    const data = Object.fromEntries(props().elements.map((e) => [e.data.id, e.data]))
    expect(data['c:1'].standing).toBe('contradicts')
    expect(data['c:3'].standing).toBe('silent')
    expect(data['c:4'].standing).toBe('backs')
    expect(data['c:2'].standing).toBe('asserts')
    expect(data['a:2'].weight).toBe(4)
    expect(data['a:1'].weight).toBe(1)
    expect('a:late' in data).toBe(false)
  })

  test('cuts long paper titles on a word boundary and keeps short ones', () => {
    open()
    const short = (id: string) => props().elements.find((e) => e.data.id === id)?.data.short
    expect(short('a:1')).toBe('ColBERT ’21')
    expect(short('a:2')).toBe('Retrieval models…')
    expect(short('a:3')).toBe('Dense passage… ’21')
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))
    expect(short('a:long')).toBe('Pneumonoultramicro… ’21')
  })

  test('counts the four findings from the graph', () => {
    open()
    expect(tile(/claims rest on a single source/)).toHaveTextContent('3')
    expect(tile(/circular citation/)).toHaveTextContent('1')
    expect(tile(/claims with no primary evidence/)).toHaveTextContent('2')
    expect(tile(/claims every paper agrees on/)).toHaveTextContent('1')
  })

  test('pressing a finding keeps its claims bright and fades the rest; pressing again clears it', () => {
    open()
    const single = tile(/claims rest on a single source/)
    fireEvent.click(single)
    expect(single).toHaveAttribute('aria-pressed', 'true')
    expect(hasClass('c:4', 'faded')).toBe(false)
    expect(hasClass('c:3', 'faded')).toBe(true)
    fireEvent.click(single)
    expect(single).toHaveAttribute('aria-pressed', 'false')
    expect(cy().elements('.faded')).toHaveLength(0)
  })

  test('a finding with a count of zero cannot be pressed', () => {
    h.graph = { ...GRAPH, paperEdges: [] }
    open()
    const circular = tile(/circular citation/)
    fireEvent.click(circular)
    expect(circular).toHaveAttribute('aria-pressed', 'false')
  })

  test('typing in the filter fades the claims that do not match; blanks change nothing', () => {
    open()
    const box = screen.getByRole('textbox', { name: 'Filter claims' })
    fireEvent.change(box, { target: { value: '   ' } })
    expect(cy().elements('.faded')).toHaveLength(0)
    fireEvent.change(box, { target: { value: 'late inter' } })
    expect(hasClass('c:1', 'faded')).toBe(false)
    expect(hasClass('c:2', 'faded')).toBe(true)
  })

  test('tapping a claim opens its detail, selects it, and tells the host', () => {
    const onSelectNode = vi.fn()
    open({ onSelectNode })
    emit(() => cy().$id('c:1').emit('tap'))
    expect(screen.getByRole('complementary', { name: 'Claim detail' })).toBeInTheDocument()
    expect(hasClass('c:1', 'selected')).toBe(true)
    expect(hasClass('c:2', 'faded')).toBe(true)
    expect(onSelectNode).toHaveBeenLastCalledWith({ id: 'c:1', label: 'Late interaction wins.' })
  })

  test('closing the detail, or tapping empty canvas, clears the selection', () => {
    const onSelectNode = vi.fn()
    open({ onSelectNode })
    emit(() => cy().$id('c:1').emit('tap'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(onSelectNode).toHaveBeenLastCalledWith(null)

    emit(() => cy().$id('c:1').emit('tap'))
    emit(() => cy().emit('tap'))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  test('tapping a paper leaves the selection alone', () => {
    open()
    emit(() => cy().$id('c:1').emit('tap'))
    emit(() => cy().$id('a:1').emit('tap'))
    expect(screen.getByRole('complementary', { name: 'Claim detail' })).toBeInTheDocument()
  })

  test('opens on the claim named in the address', () => {
    window.history.replaceState({}, '', '/?claim=c:3')
    open()
    expect(screen.getByRole('heading', { name: 'Silent and backed.' })).toBeInTheDocument()
    expect(hasClass('c:3', 'selected')).toBe(true)
  })

  test('a claim in the address that the graph does not have selects nothing', () => {
    window.history.replaceState({}, '', '/?claim=gone')
    open()
    expect(cy().elements('.selected')).toHaveLength(0)
  })

  test('leaving the screen tells the host there is no selected node', () => {
    const onSelectNode = vi.fn()
    const { unmount } = open({ onSelectNode })
    unmount()
    expect(onSelectNode).toHaveBeenLastCalledWith(null)
  })

  test('lists the claims under the graph, contradicted first, and choosing one opens its detail', () => {
    open()
    const list = screen.getByText(/Claims as a list/).closest('details')!
    const rows = within(list).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Late interaction wins.'),
      expect.stringContaining('Silent and backed.'),
      expect.stringContaining('Backed only.'),
      expect.stringContaining('A claim with no edges.'),
      expect.stringContaining('Unchecked only.'),
    ])
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(rows[0])
    expect(screen.getByRole('complementary', { name: 'Claim detail' })).toBeInTheDocument()
    expect(within(list).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
  })

  test('in the papers view the faded look comes after the edge look, so edges still dim', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))
    const selectors = (h.props as CytoscapeProps).stylesheet.map((rule) => rule.selector)
    expect(selectors.lastIndexOf('edge.faded')).toBeGreaterThan(selectors.indexOf('edge[kind="paper"]'))
  })

  test('has no claim list in the papers view, but a list of links that follows the filter', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))
    expect(screen.queryByText(/Claims as a list/)).toBeNull()
    const list = () => screen.getByText(/Links as a list/).closest('details')!
    expect(within(list()).getAllByRole('button')).toHaveLength(3)
    fireEvent.click(screen.getByRole('radio', { name: 'Strong links only' }))
    expect(within(list()).getAllByRole('button')).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: 'Citations' }))
    const rows = within(list()).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('One cites the other')
    fireEvent.click(rows[0])
    expect(screen.getByRole('complementary', { name: 'Pair detail' })).toBeInTheDocument()
    expect(within(list()).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
  })

  test('a link that is not a citation says how many works the two papers share', () => {
    const [, , shared] = (GRAPH as KnowledgeGraph).paperEdges
    h.graph = { ...GRAPH, paperEdges: [{ ...shared, citations: 1 }] }
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))
    expect(screen.getByText('1 cited work in common')).toBeInTheDocument()
  })

  test('an insight tile that counts nothing cannot be pressed', () => {
    h.graph = { ...GRAPH, nodes: GRAPH.nodes.filter((n) => n.kind === 'paper'), edges: [], paperEdges: [] }
    open()
    const tiles = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  test('shows the claims legend', () => {
    open()
    expect(screen.getByText(/1 not in a public index/)).toBeInTheDocument()
    expect(screen.getByText('contradicted')).toBeInTheDocument()
  })
})

describe('Graph · papers view', () => {
  const toPapers = () => fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))

  test('titles the view, draws every paper and its links, and shows the papers legend', () => {
    open()
    toPapers()
    expect(screen.getByRole('heading', { name: 'How your library relates' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Filter claims' })).toBeNull()
    expect(screen.getByText('Cluster')).toBeInTheDocument()
    const ids = props().elements.map((e) => e.data.id)
    expect(ids).toEqual(['a:1', 'a:2', 'a:3', 'a:long', 'a:late', 'p1', 'p2', 'p3'])
    expect(props().elements.find((e) => e.data.id === 'a:1')?.data.weight).toBe(3)
    expect(props().elements.find((e) => e.data.id === 'a:late')?.data.weight).toBe(1)
  })

  test('colours papers by cluster in the stylesheet', () => {
    open()
    toPapers()
    const selectors = props().stylesheet.map((s) => s.selector)
    expect(selectors).toContain('node[cluster="Analysed"]')
    expect(selectors).toContain('node[cluster="Cited"]')
  })

  test('"Strong links only" keeps links with similarity of 0.5 or more', () => {
    open()
    toPapers()
    fireEvent.click(screen.getByRole('radio', { name: 'Strong links only' }))
    expect(props().elements.filter((e) => e.data.kind === 'paper' && e.data.source).map((e) => e.data.id)).toEqual(['p1', 'p3'])
  })

  test('"Citations" keeps only links where one paper cites the other', () => {
    open()
    toPapers()
    fireEvent.click(screen.getByRole('radio', { name: 'Citations' }))
    expect(props().elements.filter((e) => e.data.kind === 'paper' && e.data.source).map((e) => e.data.id)).toEqual(['p1', 'p2'])
  })

  test('tapping a link opens the pair detail and highlights the pair', () => {
    open()
    toPapers()
    emit(() => cy().$id('p3').emit('tap'))
    expect(screen.getByRole('complementary', { name: 'Pair detail' })).toBeInTheDocument()
    expect(hasClass('p3', 'selected')).toBe(true)
    expect(hasClass('a:2', 'faded')).toBe(true)
    expect(hasClass('a:3', 'faded')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  test('tapping empty canvas clears the pair', () => {
    open()
    toPapers()
    emit(() => cy().$id('p3').emit('tap'))
    emit(() => cy().emit('tap'))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  test('opens on the view and pair named in the address', () => {
    window.history.replaceState({}, '', '/?view=papers&pair=p1')
    open()
    expect(screen.getByRole('complementary', { name: 'Pair detail' })).toBeInTheDocument()
  })

  test('a pair in the address that the graph does not have selects nothing', () => {
    window.history.replaceState({}, '', '/?view=papers&pair=gone')
    open()
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(cy().elements('.selected')).toHaveLength(0)
  })
})

describe('Graph · hover', () => {
  const hover = (id: string) => emit(() => cy().$id(id).emit('mouseover'))

  test('hovering a node spotlights its neighbours and shows its full label; leaving clears both', () => {
    open()
    hover('a:3')
    expect(screen.getByText('Dense passage retrieval for open domain')).toBeInTheDocument()
    expect(hasClass('a:3', 'faded')).toBe(false)
    expect(hasClass('c:1', 'faded')).toBe(true)
    emit(() => cy().$id('a:3').emit('mouseout'))
    expect(screen.queryByText('Dense passage retrieval for open domain')).toBeNull()
    expect(cy().elements('.faded')).toHaveLength(0)
  })

  // The claim list under the graph repeats each claim's words, so the tooltip is the one over the canvas.
  const tooltip = (text: string) => screen.queryAllByText(text).find((el) => el.className.includes('max-w-xs'))

  test('a node near the top edge gets its tooltip below it, any other above', () => {
    open()
    cy().$id('c:1').position({ x: 10, y: 5 })
    hover('c:1')
    expect(tooltip('Late interaction wins.')?.className).toContain('translate-y-2')
    cy().$id('c:2').position({ x: 10, y: 300 })
    hover('c:2')
    expect(tooltip('A claim with no edges.')?.className).toContain('-translate-y-full')
  })

  test.each([
    ['dragging a node', () => cy().$id('c:1').emit('drag')],
    ['panning', () => cy().emit('pan')],
    ['zooming', () => cy().emit('zoom')],
  ])('%s hides the tooltip', (_, move) => {
    open()
    hover('c:1')
    expect(tooltip('Late interaction wins.')).toBeDefined()
    emit(move)
    expect(tooltip('Late interaction wins.')).toBeUndefined()
  })

  test('a hovered node that is not in the view spotlights nothing', () => {
    open()
    hover('c:1')
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }))
    expect(cy().elements('.faded')).toHaveLength(0)
  })
})

describe('Graph · zoom stack', () => {
  test('zoom in and out scale the current zoom', () => {
    open()
    emit(() => cy().zoom(1))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(cy().zoom()).toBeCloseTo(1.3)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(cy().zoom()).toBeCloseTo(1)
  })

  test('Fit to view fits the whole graph with a margin', () => {
    open()
    const fit = vi.spyOn(cy(), 'fit')
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }))
    expect(fit).toHaveBeenCalledWith(undefined, 40)
  })

  test('buttons do nothing once the graph is destroyed', () => {
    open()
    const zoom = vi.spyOn(cy(), 'zoom')
    cy().destroy()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(zoom).not.toHaveBeenCalled()
  })

  test('buttons do nothing before the canvas has handed over its graph', () => {
    h.skipCy = true
    open()
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))).not.toThrow()
  })
})

describe('Graph · layout and the position cache', () => {
  const layoutstop = () => emit(() => cy().emit('layoutstop'))

  test('first visit runs the physics layout, then fits, centres on the latest upload and saves positions', () => {
    window.history.replaceState({}, '', '/?view=papers')
    open()
    expect(props().layout.name).toBe('cola')
    const fit = vi.spyOn(cy(), 'fit')
    const center = vi.spyOn(cy(), 'center')
    layoutstop()
    expect(fit).toHaveBeenCalled()
    expect(center).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(localStorage.getItem('ss-graph-positions-v1') ?? '{}')
    expect(Object.values(saved)[0]).toEqual(expect.objectContaining({ 'a:1': { x: expect.any(Number), y: expect.any(Number) } }))
  })

  test('does not centre when the latest upload is not drawn in this view', () => {
    open()
    const center = vi.spyOn(cy(), 'center')
    layoutstop()
    expect(center).not.toHaveBeenCalled()
  })

  test('does not centre when no paper is analysed', () => {
    h.graph = { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.kind === 'paper' ? { ...n, cluster: 'Cited' } : n)) }
    open()
    const center = vi.spyOn(cy(), 'center')
    layoutstop()
    expect(center).not.toHaveBeenCalled()
  })

  test('a layout that finishes after the graph was destroyed is ignored', () => {
    open()
    const stop = h.handlers.find(([event]) => event === 'layoutstop')?.[1] as () => void
    cy().destroy()
    expect(() => stop()).not.toThrow()
    expect(localStorage.getItem('ss-graph-positions-v1')).toBeNull()
  })

  test('a revisit replays saved positions with the preset layout and fits on the next frames', () => {
    const view = open()
    layoutstop()
    view.unmount()

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 0
    })
    open()
    expect(props().layout.name).toBe('preset')
    const saved = JSON.parse(localStorage.getItem('ss-graph-positions-v1') ?? '{}')
    const first = Object.values(saved)[0] as Record<string, { x: number; y: number }>
    expect(props().elements.find((e) => e.data.id === 'a:1')?.position).toEqual(first['a:1'])
  })

  test('a saved position map that misses a node falls back to the seeded circle', () => {
    const view = open()
    layoutstop()
    const saved = JSON.parse(localStorage.getItem('ss-graph-positions-v1') ?? '{}')
    const [key, positions] = Object.entries(saved)[0] as [string, Record<string, unknown>]
    delete positions['a:1']
    localStorage.setItem('ss-graph-positions-v1', JSON.stringify({ [key]: positions }))
    view.unmount()

    open()
    expect(props().elements.find((e) => e.data.id === 'a:1')?.position).toEqual({ x: expect.any(Number), y: expect.any(Number) })
  })

  test('an unreadable cache is ignored', () => {
    localStorage.setItem('ss-graph-positions-v1', '{broken')
    open()
    expect(props().layout.name).toBe('cola')
  })

  test('a blocked cache write does not break the layout', () => {
    open()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => layoutstop()).not.toThrow()
  })

  test('a canvas resize resizes the graph without refitting', () => {
    open()
    const resize = vi.spyOn(cy(), 'resize')
    const fit = vi.spyOn(cy(), 'fit')
    resizeCallback?.()
    expect(resize).toHaveBeenCalled()
    expect(fit).not.toHaveBeenCalled()
  })

  test('a canvas resize before the graph exists is harmless', () => {
    h.skipCy = true
    open()
    expect(() => resizeCallback?.()).not.toThrow()
  })

  test('the graph is only wired once, however often the canvas re-renders', () => {
    open()
    const taps = h.handlers.filter(([event]) => event === 'tap').length
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter claims' }), { target: { value: 'x' } })
    expect(h.handlers.filter(([event]) => event === 'tap')).toHaveLength(taps)
  })
})

describe('Graph · theme', () => {
  const ink = () => props().stylesheet[0].style.color

  test('follows the system preference under "Match system"', () => {
    systemDark = true
    open()
    expect(ink()).toBe('#F2EEF4')
  })

  test('reacts when the system preference changes', () => {
    open()
    expect(ink()).toBe('#1E1A22')
    emit(() => mediaListener?.({ matches: true }))
    expect(ink()).toBe('#F2EEF4')
  })

  test('the Settings choice wins over the system', () => {
    systemDark = true
    updateSettings({ theme: 'Light' })
    open()
    expect(ink()).toBe('#1E1A22')
    emit(() => updateSettings({ theme: 'Dark' }))
    expect(ink()).toBe('#F2EEF4')
  })
})

describe('Graph · Ask panel beside the canvas', () => {
  test('with no selection the Ask panel fills the side', () => {
    open({ askPanel: <p>Ask panel</p> })
    expect(screen.getByText('Ask panel')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Side panel' })).toBeNull()
  })

  test('a selection adds Details and Ask tabs, and Details is the one shown', () => {
    open({ askPanel: <p>Ask panel</p> })
    expect(screen.queryByRole('radiogroup', { name: 'Side panel' })).toBeNull()
    emit(() => cy().$id('c:1').emit('tap'))
    const tabs = screen.getByRole('radiogroup', { name: 'Side panel' })
    expect(within(tabs).getByRole('radio', { name: 'Details' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('complementary', { name: 'Claim detail' })).toHaveFocus()
    expect(screen.queryByText('Ask panel')).toBeNull()

    fireEvent.click(within(tabs).getByRole('radio', { name: 'Ask' }))
    expect(screen.getByText('Ask panel')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Claim detail' })).toBeNull()
  })
})

describe('Graph · the Graph | Ask the field switch', () => {
  test('is shown by default and switches to Ask the field', () => {
    render(<Graph onOpenAnalysis={noop} />)
    expect(screen.getByTestId('cytoscape-canvas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Ask the field' }))
    expect(screen.queryByTestId('cytoscape-canvas')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
  })

  test('can open straight to Ask the field, with the host Ask panel beside it', () => {
    render(<Graph onOpenAnalysis={noop} initialTab="consensus" askPanel={<p>Ask panel</p>} />)
    expect(screen.getByText('Ask panel')).toBeInTheDocument()
  })

  test('Ask the field without a host panel shows only the question screen', () => {
    render(<Graph onOpenAnalysis={noop} initialTab="consensus" />)
    expect(screen.queryByText('Ask panel')).toBeNull()
  })

  test('hideTabs leaves the switch out', () => {
    render(<Graph onOpenAnalysis={noop} hideTabs />)
    expect(screen.queryByRole('radiogroup', { name: 'Screen' })).toBeNull()
  })
})
