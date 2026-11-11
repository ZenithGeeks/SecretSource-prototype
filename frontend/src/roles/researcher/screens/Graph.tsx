/**
 * 16/07 Knowledge graph (Researcher). Two modes on one canvas:
 *  - Claims ("What rests on what"): claims and the papers that back / contradict / ignore them.
 *  - Papers ("How your library relates"): the papers you analysed and the works they cite;
 *    dashed edges are citations, solid edges join two of your papers that cite the same works,
 *    and a selected pair shows the quotes behind the link.
 *
 * In both, a cited work no public index knew (Semantic Scholar, arXiv, Unpaywall) has a dashed
 * amber ring, so a reader can see which verdicts rest on a source outside the index. We never
 * say Scopus: none of those services can tell us whether a work is in it.
 *
 * Rendered with Cytoscape + cola (a deterministic settle-then-stop layout). Data from
 * useKnowledgeGraph, built from every paper the
 * signed-in user analysed. Cytoscape's style parser rejects oklch(), so colours are concrete
 * hex mirroring the index.css tokens, in both themes.
 */

import cytoscape from 'cytoscape'
import cola from 'cytoscape-cola'
import { AlertCircle, CheckCircle2, GitFork, HelpCircle, Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'

import { Empty, ErrorState, LoadingScreen } from '../../../components/ui'
import { errorMessage } from '../../../lib/author'
import { type GraphEdge, type GraphRelation, type KnowledgeGraph, RELATION_STANDING } from '../../../lib/researcher'
import { useSettings } from '../../../lib/settings'
import { useSlashFocus } from '../../../lib/useSlashFocus'
import { FieldConsensus } from './FieldConsensus'
import { useKnowledgeGraph } from '../../../lib/useResearcher'
import { fitReadable } from '../../../lib/graphFit'
import { cn } from '../../../lib/utils'
import { GraphClaimList } from '../components/GraphClaimList'
import { GraphPairList } from '../components/GraphPairList'
import { GraphClaimDetail, GraphPairDetail } from '../components/GraphDetail'
import { GraphClaimsLegend, GraphPapersLegend } from '../components/GraphLegend'
import { GraphSegmented } from '../components/GraphSegmented'

try {
  cytoscape.use(cola)
} catch {
  /* already registered */
}

type Palette = {
  ink: string
  inkMuted: string
  surface: string
  border: string
  accent: string
  accentSoft: string
  supports: string
  refutes: string
  insufficient: string
  /** Paper-cluster hues. None is red, green or amber: those already mean contradicted, backed and silent. */
  cluster: string[]
}

const LIGHT: Palette = {
  ink: '#1E1A22', inkMuted: '#6B6370', surface: '#FFFDF9', border: '#E4DDD1',
  accent: '#6A2E6F', accentSoft: '#F1E4F2', supports: '#2F6B45', refutes: '#A33A2E',
  insufficient: '#8A6414',
  cluster: ['#6A2E6F', '#2B5F9E', '#1F7A86', '#5C6270', '#8A5A3C'],
}
const DARK: Palette = {
  ink: '#F2EEF4', inkMuted: '#B3AAB8', surface: '#2A262D', border: '#423C46',
  accent: '#C98FC4', accentSoft: '#3D2F42', supports: '#7FD39B', refutes: '#E08A76',
  insufficient: '#D8B45F',
  cluster: ['#C98FC4', '#7FAAE0', '#6CC3CF', '#A7AEBB', '#D0A07E'],
}

/** Follows the app theme from `useSettings()`, the same source the rest of the app reads: the
 * Settings choice wins, and "Match system" falls back to the OS preference. Cytoscape can't read
 * CSS variables, so the graph mirrors that decision to pick its hex palette. */
function usePalette(): { pal: Palette; dark: boolean } {
  const { theme } = useSettings()
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  const dark = theme === 'Dark' || (theme === 'Match system' && sysDark)
  return { pal: dark ? DARK : LIGHT, dark }
}

/** Cluster → colour, cycled in cluster order so new clusters stay distinguishable. */
function clusterColors(pal: Palette): string[] {
  return pal.cluster
}

/** A short node label for the canvas — the full title would overlap everything. Cuts on a word
 * boundary near the limit so it does not end mid-word. The full text stays in `data(label)` for
 * the hover tooltip and the detail panel. */
function truncate(text: string, max = 22): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max - 8 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** How a claim stands overall — same precedence as backend standing(): contradicted, then
 * silent, then backed, else no verdict yet. (Silent before backed, so one silent + one backing
 * source reads "silent" here as it does on the claim cards and stat tiles.) */
function claimStanding(edges: GraphEdge[]): GraphRelation {
  if (edges.some((e) => e.relation === 'contradicts')) return 'contradicts'
  if (edges.some((e) => e.relation === 'silent')) return 'silent'
  if (edges.some((e) => e.relation === 'backs')) return 'backs'
  return 'asserts'
}

/** The canvas label for a paper node: its short title with a two-digit year ("ColBERT ’20"). */
function paperShort(node: { label: string; year?: string }): string {
  return `${truncate(node.label, 18)}${node.year ? ` ${node.year}` : ''}`
}

type Insight = { key: string; count: number; label: string; hint: string; icon: Icon; tone: string; ids: Set<string> }
type Icon = ComponentType<{ className?: string }>

/** The four headline findings the graph exists to surface, all read off the returned graph so
 * no extra endpoint is needed: claims that rest on one source, citation cycles between analysed
 * papers, claims no cited work actually backs, and claims every cited work agrees on. */
function computeInsights(graph: KnowledgeGraph): Insight[] {
  const cited: Record<string, GraphEdge[]> = {}
  for (const e of graph.edges) if (e.relation !== 'asserts') (cited[e.target] ??= []).push(e)

  const singleSource = new Set<string>()
  const noPrimary = new Set<string>()
  const agreed = new Set<string>()
  for (const node of graph.nodes) {
    if (node.kind !== 'claim') continue
    const sources = cited[node.id] ?? []
    if (sources.length === 1) singleSource.add(node.id)
    if (sources.length > 0 && !sources.some((e) => e.relation === 'backs')) noPrimary.add(node.id)
    if (sources.length > 0 && sources.every((e) => e.relation === 'backs')) agreed.add(node.id)
  }

  // A→B and B→A both present among the citation links between analysed papers.
  const directed = new Set(graph.paperEdges.filter((e) => e.cites).map((e) => `${e.a}>${e.b}`))
  const pairs = new Set<string>()
  const cyclic = new Set<string>()
  for (const e of graph.paperEdges) {
    if (e.cites && directed.has(`${e.b}>${e.a}`)) {
      pairs.add([e.a, e.b].sort().join('~'))
      cyclic.add(e.a).add(e.b)
    }
  }

  return [
    { key: 'single', count: singleSource.size, label: 'claims rest on a single source', hint: 'Each of these claims cites one work only, so no second work backs or checks it.', icon: AlertCircle, tone: 'text-insufficient', ids: singleSource },
    { key: 'circular', count: pairs.size, label: 'circular citation (A cites B cites A)', hint: 'Two analysed papers cite each other.', icon: GitFork, tone: 'text-accent', ids: cyclic },
    { key: 'no-primary', count: noPrimary.size, label: 'claims with no primary evidence', hint: 'None of the works cited for these claims backs them.', icon: HelpCircle, tone: 'text-insufficient', ids: noPrimary },
    { key: 'agreed', count: agreed.size, label: 'claims every paper agrees on', hint: 'Every work cited for these claims backs them.', icon: CheckCircle2, tone: 'text-supports', ids: agreed },
  ]
}

type View = 'claims' | 'papers'
type PapersFilter = 'all' | 'strong' | 'citations'

function stylesheet(pal: Palette, clusters: string[], view: View): cytoscape.StylesheetJson {
  const { ink, inkMuted, surface, accent, accentSoft } = pal
  const colors = clusterColors(pal)
  const base: cytoscape.StylesheetJson = [
    {
      selector: 'node',
      style: {
        color: ink, 'font-size': 11,
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'text-wrap': 'wrap', 'text-valign': 'center', 'text-halign': 'center',
      },
    },
    {
      // A claim is a fixed-size dot (the full sentence would overlap everything). Its colour is
      // the claim's overall standing; the sentence shows on hover and in the detail panel.
      selector: 'node[kind="claim"]',
      style: {
        shape: 'ellipse', width: 16, height: 16, label: '', 'border-width': 1.5,
        'border-color': surface, 'background-color': inkMuted,
      },
    },
    { selector: 'node[standing="backs"]', style: { 'background-color': pal.supports } },
    { selector: 'node[standing="contradicts"]', style: { 'background-color': pal.refutes } },
    { selector: 'node[standing="silent"]', style: { 'background-color': pal.insufficient } },
    {
      selector: 'node[kind="paper"]',
      style: {
        // A short label sits below the node on a surface chip, so it stays readable over edges
        // and neighbours; the full title is on hover and in the panel.
        label: 'data(short)', shape: 'ellipse', color: ink, 'font-size': 10,
        'text-valign': 'bottom', 'text-margin-y': 5, 'text-max-width': '120px',
        'text-background-color': surface, 'text-background-opacity': 0.85,
        'text-background-padding': '2px', 'text-background-shape': 'roundrectangle',
        'border-width': 1.5, 'border-color': accent, 'background-color': accentSoft,
        // Bigger = more connected (Obsidian-style): sized by how many claims/works touch it.
        width: 'mapData(weight, 1, 8, 26, 54)' as unknown as number,
        height: 'mapData(weight, 1, 8, 26, 54)' as unknown as number,
      },
    },
    // Curved edges (a gentle bow) read better than straight lines when many meet at one paper.
    {
      selector: 'edge',
      style: {
        'curve-style': 'unbundled-bezier',
        'control-point-distances': '50',
        'control-point-weights': '0.5',
        width: 1.6,
        'target-arrow-shape': 'none',
        opacity: 0.9,
      },
    },
    // Claims view: colour by relation.
    { selector: 'edge[relation="backs"]', style: { 'line-color': pal.supports } },
    { selector: 'edge[relation="contradicts"]', style: { 'line-color': pal.refutes } },
    { selector: 'edge[relation="silent"]', style: { 'line-color': pal.insufficient } },
    { selector: 'edge[relation="asserts"]', style: { 'line-color': inkMuted, 'line-style': 'dashed' } },
    { selector: 'edge[relation="unchecked"]', style: { 'line-color': inkMuted, 'line-style': 'dotted', opacity: 0.7 } },
    { selector: 'node.selected', style: { 'border-color': accent, 'border-width': 2.5 } },
    { selector: '.faded', style: { opacity: 0.12 } },
  ]
  if (view === 'papers') {
    // Papers view: colour nodes by cluster; edges by similarity, dashed if a citation.
    clusters.forEach((c, i) => {
      base.push({
        selector: `node[cluster="${c}"]`,
        style: { 'background-color': colors[i % colors.length], 'border-color': colors[i % colors.length] },
      })
    })
    base.push(
      {
        selector: 'edge[kind="paper"]',
        style: { 'line-color': inkMuted, opacity: 0.55, width: 'mapData(similarity, 0.3, 1, 1.5, 6)' as unknown as number },
      },
      { selector: 'edge[?cites]', style: { 'line-style': 'dashed' } },
      // After the rule above, which sets an opacity of its own and would otherwise win over `.faded`.
      { selector: 'edge.faded', style: { opacity: 0.12 } },
      { selector: 'edge.selected', style: { 'line-color': accent, width: 5, opacity: 1 } },
    )
  }
  // Last, so it wins over the cluster colours.
  base.push({
    selector: 'node[kind="paper"][indexed="no"]',
    style: { 'border-style': 'dashed', 'border-width': 2, 'border-color': pal.insufficient, 'background-color': surface },
  })
  return base
}

// Deterministic settle-then-stop layout. Nodes start from a seeded circle (see seedPosition,
// applied in the elements) and cola runs a finite, non-random simulation, so every reload lays
// the graph out identically (SCRUM-182's "reload gives the same layout"). Nodes stay draggable
// once it settles; the initial fit runs on the layout's `layoutstop`, not a timer.
//
// animate:true runs the simulation on animation frames instead of one blocking synchronous pass,
// so a large library no longer freezes the page while the graph lays out (nodes paint at their
// seeded positions immediately, then ease into place). maxSimulationTime caps the work so even a
// big graph settles and fits within a couple of seconds. Determinism comes from randomize:false
// plus the seeded start, not from the animation, so reloads still match.
const LAYOUT = {
  name: 'cola', animate: true, infinite: false, fit: false, randomize: false,
  maxSimulationTime: 2000, convergenceThreshold: 0.01,
  nodeDimensionsIncludeLabels: true, edgeLength: 170, nodeSpacing: 14, handleDisconnected: true,
} as const

/** A circle position for node i of n — where the physics simulation starts each node. */
function seedPosition(i: number, n: number): { x: number; y: number } {
  const radius = Math.max(340, 16 * n)
  const angle = (2 * Math.PI * i) / Math.max(1, n)
  return { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)) }
}

// Replaying saved positions with `preset` is instant, so a revisit skips the physics — the slow
// part on a big library. The cola run only happens on a cache miss (a new or changed graph).
const PRESET = { name: 'preset', fit: false } as const

// Settled node positions, cached per graph so reopening the tab is instant and lays out the same
// way every time. Keyed by view + a hash of the node ids, so a changed library recomputes. Stored
// in localStorage across sessions; any storage failure just falls back to recomputing.
const POS_CACHE_KEY = 'ss-graph-positions-v1'
type PosMap = Record<string, { x: number; y: number }>
function hashIds(ids: string[]): string {
  let h = 5381
  for (const s of ids) for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
function readPosCache(key: string): PosMap | null {
  try {
    return (JSON.parse(localStorage.getItem(POS_CACHE_KEY) || '{}')[key] as PosMap) ?? null
  } catch {
    return null
  }
}
function writePosCache(key: string, positions: PosMap): void {
  try {
    const all = JSON.parse(localStorage.getItem(POS_CACHE_KEY) || '{}')
    localStorage.setItem(POS_CACHE_KEY, JSON.stringify({ ...all, [key]: positions }))
  } catch {
    /* storage full or blocked — recompute next time */
  }
}

/** One headline finding. Pressing it highlights the claims (or papers) it counts on the canvas
 * and dims the rest, so the tiles work as filters; press again to clear. */
function InsightTile({ insight, active, onToggle }: { insight: Insight; active: boolean; onToggle: () => void }) {
  const { count, label, icon: Icon, tone } = insight
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      disabled={count === 0}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-full border bg-surface py-1.5 pl-3 pr-3.5 text-left transition-colors disabled:cursor-default disabled:opacity-60 pointer-coarse:min-h-11',
        active ? 'border-accent bg-accent-soft' : 'border-border-subtle hover:border-accent/50',
      )}
    >
      <Icon className={cn('size-4 shrink-0', tone)} />
      <span className={cn('font-mono text-[15px] leading-5 tracking-[-0.01em]', tone)}>{count}</span>
      <span className="min-w-0 text-xs leading-4 text-ink-muted">{label}</span>
    </button>
  )
}


/** What a role shows in place of an empty canvas; a role that passes none gets the canvas. */
export type GraphEmptyMessage = { title: string; hint: string }

/** A graph node the reader selected, for the Ask panel's chip and context. */
export type SelectedNode = { id: string; label: string }

function GraphCanvas({
  emptyMessage,
  askPanel,
  onSelectNode,
}: {
  emptyMessage?: GraphEmptyMessage
  askPanel?: ReactNode
  onSelectNode?: (node: SelectedNode | null) => void
}) {
  const { data: graph, isError, error, refetch } = useKnowledgeGraph()
  const { pal } = usePalette()
  const cyRef = useRef<cytoscape.Core | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const filterInput = useRef<HTMLInputElement>(null)
  useSlashFocus(filterInput)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [ready, setReady] = useState(false)
  // True while cola is still placing the nodes (a layout with no saved positions takes a moment).
  const [arranging, setArranging] = useState(false)

  // Attach the ResizeObserver through a callback ref rather than an effect: an effect runs on the
  // first render, while the query is still loading and Graph returns null, when the canvas div
  // does not exist yet (and with [] deps it would never re-run). On resize we only cy.resize() —
  // never fit — so opening the detail panel or changing the window width keeps the user's zoom.
  const setCanvas = useCallback((el: HTMLDivElement | null) => {
    canvasRef.current = el
    observerRef.current?.disconnect()
    if (!el) return
    const observer = new ResizeObserver(() => cyRef.current?.resize())
    observer.observe(el)
    observerRef.current = observer
  }, [])

  const params = new URLSearchParams(window.location.search)
  const [view, setView] = useState<View>(params.get('view') === 'papers' ? 'papers' : 'claims')
  const [claimSel, setClaimSel] = useState<string | null>(params.get('claim'))
  const [pairSel, setPairSel] = useState<string | null>(params.get('pair'))
  const [filter, setFilter] = useState('')
  const [pFilter, setPFilter] = useState<PapersFilter>('all')
  // The insight tile pressed to highlight its claims on the canvas (they act as filters).
  const [insightKey, setInsightKey] = useState<string | null>(null)
  // Full label of the hovered node, positioned over the canvas — the on-node label is short.
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  // The hovered node id: like Obsidian, hovering spotlights that node's neighbours and dims the rest.
  const [hovered, setHovered] = useState<string | null>(null)
  // With Ask open the right panel has two tabs; Ask is the one the reader just opened.
  const [side, setSide] = useState<'details' | 'ask'>('ask')
  // Choosing a claim or a link is asking to see it: switch to Details even when Ask was the tab showing.
  // (Adjusting state while rendering, the pattern react.dev gives for state that follows other state.)
  const selection = claimSel ?? pairSel
  const [shown, setShown] = useState(selection)
  if (selection !== shown) {
    setShown(selection)
    if (selection) setSide('details')
  }

  // The address names the view and the chosen claim or link, so a refresh or a shared link comes back to it.
  useEffect(() => {
    const next = new URLSearchParams(window.location.search)
    const keep = (name: string, value: string | null) => (value ? next.set(name, value) : next.delete(name))
    keep('view', view === 'papers' ? 'papers' : null)
    keep('claim', claimSel)
    keep('pair', pairSel)
    window.history.replaceState(null, '', `?${next}`)
  }, [view, claimSel, pairSel])

  useEffect(() => {
    const node = view === 'claims' && claimSel ? graph?.nodes.find((n) => n.id === claimSel) : undefined
    onSelectNode?.(node ? { id: node.id, label: node.label } : null)
  }, [view, claimSel, graph, onSelectNode])
  // Leaving the canvas (for Ask the field) leaves no node to ask about.
  useEffect(() => () => onSelectNode?.(null), [onSelectNode])

  const paperIds = useMemo(
    () => (graph ? new Set(graph.edges.map((e) => e.source)) : new Set<string>()),
    [graph],
  )

  const insights = useMemo(() => (graph ? computeInsights(graph) : []), [graph])
  const activeInsight = insights.find((i) => i.key === insightKey)
  const claimRows = useMemo(() => {
    if (!graph) return []
    const byClaim: Record<string, GraphEdge[]> = {}
    for (const e of graph.edges) (byClaim[e.target] ??= []).push(e)
    return graph.nodes
      .filter((n) => n.kind === 'claim')
      .map((n) => ({ id: n.id, label: n.label, standing: RELATION_STANDING[claimStanding(byClaim[n.id] ?? [])] }))
  }, [graph])

  // The backend builds paper nodes oldest-first, so the last "Analysed" one is the most
  // recently uploaded paper — where the view opens centred, so a fresh upload is what greets
  // the reader instead of wherever the whole-graph fit happened to land.
  const latestPaperId = useMemo(
    () => graph?.nodes.filter((n) => n.kind === 'paper' && n.cluster === 'Analysed').at(-1)?.id ?? null,
    [graph],
  )

  // The node ids shown in the current view, and a cache key from them. Cached positions (if any)
  // let the layout replay instantly instead of re-running cola.
  const shownNodeIds = useMemo(() => {
    if (!graph) return [] as string[]
    return view === 'claims'
      ? graph.nodes.filter((n) => n.kind === 'claim' || paperIds.has(n.id)).map((n) => n.id)
      : graph.nodes.filter((n) => n.kind === 'paper').map((n) => n.id)
  }, [graph, view, paperIds])
  const cacheKey = useMemo(() => `${view}:${hashIds(shownNodeIds)}`, [view, shownNodeIds])
  const cachedPositions = useMemo(() => readPosCache(cacheKey), [cacheKey])

  const elements = useMemo(() => {
    if (!graph) return []
    if (view === 'claims') {
      const claimEdges: Record<string, GraphEdge[]> = {}
      const deg: Record<string, number> = {}
      graph.edges.forEach((e) => {
        ;(claimEdges[e.target] ??= []).push(e)
        deg[e.source] = (deg[e.source] ?? 0) + 1 // a paper's size = how many claims it touches
      })
      const shown = graph.nodes.filter((n) => n.kind === 'claim' || paperIds.has(n.id))
      return [
        ...shown.map((n, i) => ({
          data:
            n.kind === 'paper'
              ? { ...n, short: paperShort(n), weight: deg[n.id] }
              : { ...n, standing: claimStanding(claimEdges[n.id] ?? []) },
          position: cachedPositions?.[n.id] ?? seedPosition(i, shown.length),
        })),
        ...graph.edges.map((e) => ({ data: e })),
      ]
    }
    const deg: Record<string, number> = {}
    graph.paperEdges.forEach((e) => {
      deg[e.a] = (deg[e.a] ?? 0) + 1
      deg[e.b] = (deg[e.b] ?? 0) + 1
    })
    const edges = graph.paperEdges.filter((e) =>
      pFilter === 'strong' ? e.similarity >= 0.5 : pFilter === 'citations' ? e.cites : true,
    )
    const papers = graph.nodes.filter((n) => n.kind === 'paper')
    return [
      ...papers.map((n, i) => ({
        data: { ...n, weight: deg[n.id] ?? 1, short: paperShort(n) },
        position: cachedPositions?.[n.id] ?? seedPosition(i, papers.length),
      })),
      ...edges.map((e) => ({
        data: { id: e.id, source: e.a, target: e.b, kind: 'paper', cites: e.cites ? 1 : 0, similarity: e.similarity },
      })),
    ]
  }, [graph, view, pFilter, paperIds, cachedPositions])

  // Spotlight one node/edge's neighbourhood and fade the rest. A click selection wins; otherwise
  // hovering spotlights (Obsidian-style); otherwise the claims filter dims non-matches.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('faded selected')
      if (view === 'claims' && claimSel) {
        const node = cy.$id(claimSel)
        if (node.nonempty()) {
          cy.elements().addClass('faded')
          node.closedNeighborhood().removeClass('faded')
          node.addClass('selected')
        }
      } else if (view === 'papers' && pairSel) {
        const edge = cy.$id(pairSel)
        if (edge.nonempty()) {
          cy.elements().addClass('faded')
          edge.removeClass('faded').addClass('selected')
          edge.connectedNodes().removeClass('faded')
        }
      } else if (view === 'claims' && activeInsight) {
        // An insight tile is pressed: keep its claims (and what touches them) bright.
        const hit = cy.nodes().filter((n) => activeInsight.ids.has(n.id()))
        cy.elements().addClass('faded')
        hit.closedNeighborhood().removeClass('faded')
      } else if (hovered) {
        const node = cy.$id(hovered)
        if (node.nonempty()) {
          cy.elements().addClass('faded')
          node.closedNeighborhood().removeClass('faded')
        }
      } else if (view === 'claims' && filter.trim()) {
        const q = filter.toLowerCase()
        cy.nodes('[kind="claim"]').forEach((n) => {
          if (!String(n.data('label')).toLowerCase().includes(q)) n.addClass('faded')
        })
      }
    })
  }, [view, filter, claimSel, pairSel, hovered, activeInsight, elements, ready])

  // Recolour the existing graph on a theme change instead of rebuilding it. The CytoscapeComponent
  // key is `view` only (not the theme), so flipping light/dark keeps the instance and the user's
  // zoom, pan and dragged positions — this just re-applies the palette to the live stylesheet.
  useEffect(() => {
    const cy = cyRef.current
    if (cy && graph) cy.style(stylesheet(pal, graph.clusters, view))
  }, [pal, view, graph])

  // Ask stays open while the graph loads, fails or is empty.
  const withAsk = (content: ReactNode) =>
    askPanel ? (
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">{content}</div>
        <div className="overflow-hidden lg:h-[calc(100dvh-14rem)] lg:w-[400px] lg:shrink-0 lg:rounded-2xl lg:border lg:border-border-subtle">
          {askPanel}
        </div>
      </div>
    ) : (
      content
    )
  if (isError) {
    return withAsk(<ErrorState title="The graph could not load" message={errorMessage(error)} onRetry={() => refetch()} />)
  }
  if (!graph) return withAsk(<LoadingScreen label="Loading the graph…" />)
  if (emptyMessage && graph.nodes.length === 0) return withAsk(<Empty title={emptyMessage.title} hint={emptyMessage.hint} />)

  const title = view === 'claims' ? 'What rests on what' : 'How your library relates'
  const subtitle =
    view === 'claims'
      ? 'Claims and the papers that back, contradict, or ignore them. Choose a claim to see its evidence.'
      : 'Choose a link to compare a pair of papers. The key in the corner says what the lines mean.'
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.label]))
  // The list follows what the canvas shows: the filter text and the pressed finding both narrow it.
  const listedClaims = claimRows
    .filter((row) => !filter.trim() || row.label.toLowerCase().includes(filter.trim().toLowerCase()))
    .filter((row) => !activeInsight || activeInsight.ids.has(row.id))
  const pairRows = graph.paperEdges
    .filter((e) => (pFilter === 'strong' ? e.similarity >= 0.5 : pFilter === 'citations' ? e.cites : true))
    .map((e) => ({
      id: e.id,
      label: `${names[e.a]} and ${names[e.b]}`,
      relation: e.cites ? 'One cites the other' : `${e.citations} cited ${e.citations === 1 ? 'work' : 'works'} in common`,
    }))
  const paperCount = graph.nodes.filter((n) => n.kind === 'paper').length
  const claimCount = graph.nodes.filter((n) => n.kind === 'claim').length
  const notIndexed = graph.nodes.filter((n) => n.kind === 'paper' && n.indexed === 'no').length
  const selectedEdge = pairSel ? graph.paperEdges.find((e) => e.id === pairSel) : undefined
  const detail =
    view === 'claims' && claimSel ? (
      <GraphClaimDetail graph={graph} claimId={claimSel} onClose={() => setClaimSel(null)} />
    ) : view === 'papers' && selectedEdge ? (
      <GraphPairDetail graph={graph} edge={selectedEdge} onClose={() => setPairSel(null)} />
    ) : null

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="type-display text-ink">{title}</h1>
          <p className="max-w-3xl text-[15px] leading-6 text-ink-muted">{subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
          <GraphSegmented
            label="Graph view"
            value={view}
            options={[
              { key: 'claims', label: 'Claims' },
              { key: 'papers', label: 'Papers' },
            ]}
            onChange={setView}
          />
          <span className="text-xs text-ink-muted">
            {paperCount} papers · {claimCount} claims
          </span>
        </div>
      </header>

      {view === 'papers' && (
        <div>
          <GraphSegmented
            label="Papers view filter"
            value={pFilter}
            options={[
              { key: 'all', label: `All ${paperCount} papers` },
              { key: 'strong', label: 'Strong links only' },
              { key: 'citations', label: 'Citations' },
            ]}
            onChange={setPFilter}
          />
          {pFilter === 'strong' && (
            <p className="mt-2 text-[13px] text-ink-muted">
              Strong links join two papers when at least half of all the works they cite are cited by both.
            </p>
          )}
        </div>
      )}

      {view === 'claims' && (
        // The findings are filters on the canvas, opened on demand so the first view is the graph.
        // The summary names the pressed one, so a closed disclosure still says why claims are dimmed.
        <details className="rounded-xl border border-border-subtle bg-surface">
          <summary className="cursor-pointer rounded-xl px-4 py-3 text-[13px] font-medium text-ink pointer-coarse:min-h-11">
            {activeInsight ? `Findings · showing ${activeInsight.label}` : `Findings · ${insights.filter((i) => i.count > 0).length} to look at`}
          </summary>
          <div className="flex flex-wrap gap-2 border-t border-border-subtle p-3">
            {insights.map((insight) => (
              <InsightTile
                key={insight.key}
                insight={insight}
                active={insightKey === insight.key}
                onToggle={() => setInsightKey(insightKey === insight.key || insight.count === 0 ? null : insight.key)}
              />
            ))}
            {activeInsight && (
              <p className="basis-full text-[13px] text-ink-muted">
                {activeInsight.hint} The other claims are dimmed on the graph.
              </p>
            )}
          </div>
        </details>
      )}

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
        {/* This screen is only the graph, so give the canvas the viewport height (height is the
            binding constraint for fitting the whole graph), with a min so it can't collapse on a
            short window. The role shell is `wide` for Graph, so it also uses the screen width. */}
        <div
          ref={setCanvas}
          className="relative min-h-[420px] min-w-0 flex-1 sm:min-h-[560px] overflow-hidden rounded-[14px] border border-border-subtle bg-canvas lg:h-[calc(100dvh-22rem)]"
        >
          {/* Zoom and fit, so a dense library can be opened up and re-framed. */}
          <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-[10px] border border-border-subtle bg-surface">
            {[
              { icon: ZoomIn, label: 'Zoom in', factor: 1.3 },
              { icon: ZoomOut, label: 'Zoom out', factor: 1 / 1.3 },
              { icon: Maximize2, label: 'Fit to view', factor: 0 },
            ].map(({ icon: Icon, label, factor }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => {
                  const cy = cyRef.current
                  if (!cy || cy.destroyed()) return
                  if (factor === 0) cy.fit(undefined, 40)
                  else cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
                }}
                className="flex size-8 items-center justify-center text-ink-muted hover:bg-accent-soft hover:text-ink pointer-coarse:size-11"
              >
                <Icon aria-hidden="true" className="size-4" />
              </button>
            ))}
          </div>
          {view === 'claims' && (
            // On a phone the zoom column takes the right edge, so the filter shrinks to fit beside it.
            <div className="absolute left-3 top-3 z-10 flex w-[min(220px,calc(100%-6rem))] items-center gap-2 rounded-[9px] border border-border-subtle bg-surface px-2.5 py-[7px] focus-within:ring-2 focus-within:ring-accent/40">
              <Search className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <input
                ref={filterInput}
                aria-keyshortcuts="/"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter claims (press /)"
                aria-label="Filter claims"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
              />
            </div>
          )}
          <CytoscapeComponent
            key={view}
            elements={elements}
            stylesheet={stylesheet(pal, graph.clusters, view)}
            layout={cachedPositions ? PRESET : LAYOUT}
            style={{ width: '100%', height: '100%' }}
            cy={(cy: cytoscape.Core) => {
              // react-cytoscapejs calls this on every render (componentDidUpdate), not just mount.
              // Only wire a given instance once, so a state change (filtering, selecting a claim)
              // never re-runs fit and throws away the user's zoom.
              if (cyRef.current === cy) return
              cyRef.current = cy
              cy.on('tap', 'node[kind="claim"]', (evt: cytoscape.EventObject) => {
                setClaimSel(evt.target.id())
              })
              cy.on('tap', 'edge[kind="paper"]', (evt: cytoscape.EventObject) => {
                setPairSel(evt.target.id())
              })
              cy.on('tap', (evt: cytoscape.EventObject) => {
                if (evt.target === cy) {
                  setClaimSel(null)
                  setPairSel(null)
                }
              })
              // Hover: show the full label and spotlight this node's neighbourhood (Obsidian-style).
              cy.on('mouseover', 'node', (evt: cytoscape.EventObject) => {
                const p = evt.target.renderedPosition()
                setTip({ x: p.x, y: p.y, text: String(evt.target.data('label')) })
                setHovered(evt.target.id())
              })
              cy.on('mouseout', 'node', () => {
                setTip(null)
                setHovered(null)
              })
              cy.on('drag', 'node', () => setTip(null))
              cy.on('pan zoom', () => setTip(null))
              // Pan (zoom stays whatever fitReadable set) so the latest upload is what's centred
              // on open, not wherever the whole-graph bounding box happened to land it.
              const focusLatest = () => {
                if (cy.destroyed() || !latestPaperId) return
                const node = cy.$id(latestPaperId)
                if (node.nonempty()) cy.center(node)
              }
              // Fit once the layout has actually settled (cola emits layoutstop), not on a fixed
              // timer that can fire while nodes are still bunched. It re-runs only when the element
              // set changes (e.g. switching Claims/Papers), which re-runs the layout.
              cy.on('layoutstop', () => {
                // Cola is async: this can fire after navigating away destroyed the graph.
                if (cy.destroyed()) return
                setArranging(false)
                fitReadable(cy)
                focusLatest()
                // Save the settled positions so the next visit replays them instantly with `preset`
                // instead of re-running cola — and so reloads lay out identically.
                const pos: PosMap = {}
                cy.nodes().forEach((node) => {
                  const p = node.position()
                  pos[node.id()] = { x: Math.round(p.x), y: Math.round(p.y) }
                })
                writePosCache(cacheKey, pos)
              })
              // react-cytoscapejs runs `preset` synchronously inside componentDidMount, before
              // this `cy` prop is ever called — so on a cached revisit, layoutstop above already
              // fired and is gone; the listener never sees it. Positions are final either way for
              // `preset` (no simulation to wait for), so just fit/centre directly here instead.
              // The double rAF waits for the canvas div's first real layout pass — at this exact
              // point it can still be a zero-size placeholder, which would fit to the wrong box.
              if (cachedPositions) {
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    fitReadable(cy)
                    focusLatest()
                  }),
                )
              }
              setArranging(!cachedPositions)
              setReady(true)
            }}
          />
          {view === 'claims' ? (
            <GraphClaimsLegend colors={pal} notIndexed={notIndexed} />
          ) : (
            <GraphPapersLegend colors={pal} clusters={graph.clusters} clusterColors={clusterColors(pal)} notIndexed={notIndexed} />
          )}
          {arranging && (
            <p
              role="status"
              className="absolute bottom-3 right-3 z-10 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-ink-muted"
            >
              Arranging the graph…
            </p>
          )}
          {tip && (
            // Near the top edge the above-the-node tooltip would render past y=0 and be clipped by
            // the overflow-hidden canvas, so flip it below the node there.
            <div
              className={cn(
                'pointer-events-none absolute z-20 max-w-xs -translate-x-1/2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs leading-snug text-ink shadow-lg',
                tip.y < 56 ? 'translate-y-2' : '-translate-y-full',
              )}
              style={{ left: tip.x, top: tip.y < 56 ? tip.y + 12 : tip.y - 10 }}
            >
              {tip.text}
            </div>
          )}
        </div>

        {askPanel ? (
          <div className="flex w-full flex-col gap-2 lg:w-[400px] lg:shrink-0">
            {detail && (
              <GraphSegmented
                label="Side panel"
                value={side}
                options={[
                  { key: 'details', label: 'Details' },
                  { key: 'ask', label: 'Ask' },
                ]}
                onChange={setSide}
              />
            )}
            {detail && side === 'details' ? (
              detail
            ) : (
              <div className="overflow-hidden lg:h-[calc(100dvh-22rem)] lg:min-h-[560px] lg:rounded-2xl lg:border lg:border-border-subtle">
                {askPanel}
              </div>
            )}
          </div>
        ) : (
          detail
        )}
      </div>

      {/* The canvas can only be read and driven with a pointer; the same claims as a list are for keyboards,
          screen readers and anyone who wants the contradicted ones first. */}
      {view === 'claims' && (
        <GraphClaimList rows={listedClaims} total={claimRows.length} selectedId={claimSel} onSelect={setClaimSel} />
      )}
      {view === 'papers' && <GraphPairList rows={pairRows} selectedId={pairSel} onSelect={setPairSel} />}
    </>
  )
}

/** The Graph tab. It hosts two views behind one toggle: the knowledge graph (GraphCanvas,
 * unchanged) and Field Consensus, which asks one claim across the whole library. Field consensus
 * used to be its own screen — it now lives here, so the graph and the cross-paper question share
 * one place. `initialTab` lets the router open straight to Consensus from an older link.
 * `emptyMessage` is what a role with nothing analysed yet sees instead of a bare canvas (the
 * Author passes one; the Researcher keeps the canvas). */
export function Graph({
  onOpenAnalysis,
  initialTab = 'graph',
  emptyMessage,
  hideTabs = false,
  askPanel,
  onSelectNode,
}: {
  onOpenAnalysis: (id: string) => void
  initialTab?: 'graph' | 'consensus'
  emptyMessage?: GraphEmptyMessage
  /** Leaves out the Graph | Ask the field switch, for a host that reaches each from its own nav. */
  hideTabs?: boolean
  /** The Ask panel, shown as a tab of the graph's right panel while it is open. */
  askPanel?: ReactNode
  /** Told which claim node is selected, so a question can be about it. */
  onSelectNode?: (node: SelectedNode | null) => void
}) {
  const [tab, setTab] = useState<'graph' | 'consensus'>(initialTab)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {!hideTabs && (
        <div>
          <GraphSegmented
            label="Screen"
            value={tab}
            options={[
              { key: 'graph', label: 'Graph' },
              { key: 'consensus', label: 'Ask the field' },
            ]}
            onChange={setTab}
          />
        </div>
      )}
      {tab === 'graph' ? (
        <GraphCanvas emptyMessage={emptyMessage} askPanel={askPanel} onSelectNode={onSelectNode} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <FieldConsensus onOpenAnalysis={onOpenAnalysis} />
          </div>
          {askPanel && (
            <div className="overflow-hidden lg:sticky lg:top-[68px] lg:h-[calc(100dvh-6rem)] lg:w-[400px] lg:shrink-0 lg:rounded-2xl lg:border lg:border-border-subtle">
              {askPanel}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
