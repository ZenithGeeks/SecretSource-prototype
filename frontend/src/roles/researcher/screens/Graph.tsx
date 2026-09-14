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
 * Rendered with Cytoscape + fcose. Data from useKnowledgeGraph, built from every paper the
 * signed-in user analysed. Cytoscape's style parser rejects oklch(), so colours are concrete
 * hex mirroring the index.css tokens, in both themes.
 */

import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { AlertCircle, Bookmark, CheckCircle2, Copy, ExternalLink, FileText, GitFork, HelpCircle, Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'

import { reasonText } from '../../../lib/api'
import type { GraphEdge, GraphNode, GraphRelation, KnowledgeGraph, PaperEdge } from '../../../lib/researcher'
import { useKnowledgeGraph } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'

let _fcoseReady = false
if (!_fcoseReady) {
  try {
    cytoscape.use(fcose)
  } catch {
    /* already registered */
  }
  _fcoseReady = true
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
}

const LIGHT: Palette = {
  ink: '#1E1A22', inkMuted: '#6B6370', surface: '#FFFDF9', border: '#E4DDD1',
  accent: '#6A2E6F', accentSoft: '#F1E4F2', supports: '#2F6B45', refutes: '#A33A2E',
  insufficient: '#8A6414',
}
const DARK: Palette = {
  ink: '#F2EEF4', inkMuted: '#B3AAB8', surface: '#2A262D', border: '#423C46',
  accent: '#C98FC4', accentSoft: '#3D2F42', supports: '#7FD39B', refutes: '#E08A76',
  insufficient: '#D8B45F',
}

/** Follows the app theme: the Settings choice (`data-theme` on <html>) wins, and with no choice
 * set it falls back to the OS preference — matching how index.css applies the palette. Cytoscape
 * can't read CSS variables, so the graph mirrors the same decision to pick its hex palette. */
function usePalette(): { pal: Palette; dark: boolean } {
  const isDark = () => {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark') return true
    if (attr === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const update = () => setDark(isDark())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])
  return { pal: dark ? DARK : LIGHT, dark }
}

const RELATION_LABEL: Record<GraphRelation, string> = {
  asserts: 'asserts', backs: 'backs', contradicts: 'contradicts', silent: 'silent', unchecked: "couldn't check",
}

function relationColor(pal: Palette, relation: GraphRelation): string {
  return relation === 'backs' ? pal.supports
    : relation === 'contradicts' ? pal.refutes
      : relation === 'silent' ? pal.insufficient
        : pal.inkMuted
}

/** Cluster → colour, cycled in cluster order so new clusters stay distinguishable. */
function clusterColors(pal: Palette): string[] {
  return [pal.accent, pal.supports, pal.insufficient, pal.inkMuted, pal.refutes]
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

/** How a claim stands overall, worst-first, so its dot colour shows contradiction at a glance. */
function claimStanding(edges: GraphEdge[]): GraphRelation {
  if (edges.some((e) => e.relation === 'contradicts')) return 'contradicts'
  if (edges.some((e) => e.relation === 'backs')) return 'backs'
  if (edges.some((e) => e.relation === 'silent')) return 'silent'
  return 'asserts'
}

/** The canvas label for a paper node: its short title with a two-digit year ("ColBERT ’20"). */
function paperShort(node: { label: string; year?: string }): string {
  return `${truncate(node.label, 18)}${node.year ? ` ${node.year}` : ''}`
}

type Insight = { key: string; count: number; label: string; icon: Icon; tone: string }
type Icon = ComponentType<{ className?: string }>

/** The four headline findings the graph exists to surface, all read off the returned graph so
 * no extra endpoint is needed: claims that rest on one source, citation cycles between analysed
 * papers, claims no cited work actually backs, and claims every cited work agrees on. */
function computeInsights(graph: KnowledgeGraph): Insight[] {
  const cited: Record<string, GraphEdge[]> = {}
  for (const e of graph.edges) if (e.relation !== 'asserts') (cited[e.target] ??= []).push(e)

  let singleSource = 0
  let noPrimary = 0
  let agreed = 0
  for (const node of graph.nodes) {
    if (node.kind !== 'claim') continue
    const sources = cited[node.id] ?? []
    if (sources.length === 1) singleSource++
    if (sources.length > 0 && !sources.some((e) => e.relation === 'backs')) noPrimary++
    if (sources.length > 0 && sources.every((e) => e.relation === 'backs')) agreed++
  }

  // A→B and B→A both present among the citation links between analysed papers.
  const directed = new Set(graph.paperEdges.filter((e) => e.cites).map((e) => `${e.a}>${e.b}`))
  const pairs = new Set<string>()
  for (const e of graph.paperEdges) {
    if (e.cites && directed.has(`${e.b}>${e.a}`)) pairs.add([e.a, e.b].sort().join('~'))
  }

  return [
    { key: 'single', count: singleSource, label: 'claims rest on a single source', icon: AlertCircle, tone: 'text-insufficient' },
    { key: 'circular', count: pairs.size, label: 'circular citation (A cites B cites A)', icon: GitFork, tone: 'text-accent' },
    { key: 'no-primary', count: noPrimary, label: 'claims with no primary evidence', icon: HelpCircle, tone: 'text-insufficient' },
    { key: 'agreed', count: agreed, label: 'claims every paper agrees on', icon: CheckCircle2, tone: 'text-supports' },
  ]
}

type View = 'claims' | 'papers'
type PapersFilter = 'all' | 'strong' | 'citations'

function stylesheet(pal: Palette, clusters: string[], view: View): cytoscape.StylesheetJson {
  const { ink, inkMuted, surface, border, accent, accentSoft } = pal
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
        // Papers view sizes by how connected a paper is; claims view is uniform.
        width: view === 'papers' ? ('mapData(weight, 1, 5, 26, 48)' as unknown as number) : 30,
        height: view === 'papers' ? ('mapData(weight, 1, 5, 26, 48)' as unknown as number) : 30,
      },
    },
    { selector: 'edge', style: { 'curve-style': 'bezier', width: 2, 'target-arrow-shape': 'none', opacity: 0.9 } },
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
        style: { 'line-color': border, width: 'mapData(similarity, 0.3, 1, 1.5, 6)' as unknown as number },
      },
      { selector: 'edge[?cites]', style: { 'line-style': 'dashed' } },
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

// randomize:false makes fcose deterministic, so a reload lays the graph out the same way.
// nodeDimensionsIncludeLabels keeps the short paper labels from overlapping. Edges are short so
// each paper's claim dots sit close around it instead of flung across the canvas.
const LAYOUT = {
  name: 'fcose', animate: false, randomize: false, fit: true, quality: 'proof',
  nodeDimensionsIncludeLabels: true, nodeSeparation: 130, idealEdgeLength: 95,
  packComponents: true, padding: 40,
} as const

function InsightTile({ insight }: { insight: Insight }) {
  const { count, label, icon: Icon, tone } = insight
  return (
    <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5">
      <Icon className={cn('size-4 shrink-0', tone)} />
      <span className={cn('font-serif text-lg font-semibold', tone)}>{count}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  )
}

/** The legend key for the dashed amber ring, with how many works carry it. */
function NotIndexedKey({ pal, count }: { pal: Palette; count: number }) {
  if (!count) return null
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-ink-muted"
      title="Semantic Scholar, arXiv and Unpaywall found nothing for this reference as it is written. This is not a Scopus check."
    >
      <span className="size-2.5 rounded-full border-[1.5px] border-dashed" style={{ borderColor: pal.insufficient }} />
      {count} not found in a public index
    </span>
  )
}

/** Two rows, as in Figma: what a claim dot's colour means, then what an edge's style means. */
function ClaimsLegend({ pal, notIndexed }: { pal: Palette; notIndexed: number }) {
  // Claim dot colours mirror node[standing] in the stylesheet; a grey dot is a claim no cited
  // work has answered yet.
  const dots: [GraphRelation, string][] = [
    ['contradicts', 'contradicted'],
    ['backs', 'backed'],
    ['silent', 'silent'],
    ['asserts', 'no verdict yet'],
  ]
  const lines: GraphRelation[] = ['asserts', 'backs', 'contradicts', 'silent', 'unchecked']
  const lined = (r: GraphRelation) => r === 'asserts' || r === 'unchecked'
  const row = 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-subtle bg-surface/90 px-3 py-1.5 backdrop-blur'
  return (
    <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1.5">
      <div className={row}>
        <span className="text-xs font-medium text-ink">claim</span>
        {dots.map(([rel, label]) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: relationColor(pal, rel) }} />
            {label}
          </span>
        ))}
      </div>
      <div className={row}>
        {lines.map((r) => (
          <span key={r} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span
              className={cn(
                'inline-block h-0.5 w-5',
                r === 'asserts' && 'border-t border-dashed',
                r === 'unchecked' && 'border-t-2 border-dotted',
              )}
              style={lined(r) ? { borderColor: relationColor(pal, r) } : { backgroundColor: relationColor(pal, r) }}
            />
            {RELATION_LABEL[r]}
          </span>
        ))}
        <NotIndexedKey pal={pal} count={notIndexed} />
      </div>
    </div>
  )
}

function ClusterLegend({ pal, clusters, notIndexed }: { pal: Palette; clusters: string[]; notIndexed: number }) {
  const colors = clusterColors(pal)
  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-3 rounded-lg border border-border-subtle bg-surface/90 px-3 py-1.5 backdrop-blur">
      {clusters.map((c, i) => (
        <span key={c} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="size-2 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
          {c}
        </span>
      ))}
      <NotIndexedKey pal={pal} count={notIndexed} />
    </div>
  )
}

/** Under a cited work in a detail panel: which index knew it, or that none did. */
function IndexNote({ node }: { node: GraphNode | undefined }) {
  if (node?.kind !== 'paper' || !node.indexed) return null
  return node.indexed === 'no' ? (
    <p className="text-xs font-medium text-insufficient">Not found in a public index</p>
  ) : (
    <p className="text-xs text-ink-muted">Found in {node.index || 'a public index'}</p>
  )
}

function ClaimDetail({ graph, claimId, pal }: { graph: KnowledgeGraph; claimId: string; pal: Palette }) {
  const claim = graph.nodes.find((n) => n.id === claimId)
  const edges = graph.edges.filter((e) => e.target === claimId)
  const paper = (id: string) => graph.nodes.find((n) => n.id === id)
  if (!claim || claim.kind !== 'claim') return null
  const contradicts = edges.some((e) => e.relation === 'contradicts')
  const singleOrigin = edges.filter((e) => e.relation === 'asserts').length <= 1

  return (
    <aside className="w-full overflow-y-auto rounded-xl border border-border-subtle bg-surface p-5 lg:w-80 lg:shrink-0">
      <p className="mb-2 inline-block rounded bg-refutes-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-refutes">
        {contradicts ? 'Source contradicts' : 'Traced'}
      </p>
      <span className="ml-2 text-xs text-ink-muted">claim · {edges.length} papers involved</span>
      <h2 className="mt-2 font-serif text-lg font-semibold leading-snug text-ink">{claim.label}</h2>
      <p className="mt-4 text-xs font-semibold text-ink-muted">Where it comes from</p>
      <ul className="mt-2 flex flex-col gap-3">
        {edges.map((e) => {
          const p = paper(e.source)
          return (
            <li key={e.id} className="flex gap-2">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: relationColor(pal, e.relation) }} />
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {p?.kind === 'paper' ? `${p.label}${p.year ? ` · 20${p.year.replace(/\D/g, '')}` : ''}` : e.source}{' '}
                  <span className="text-xs font-medium" style={{ color: relationColor(pal, e.relation) }}>
                    {e.relation === 'asserts' ? 'origin — asserts' : RELATION_LABEL[e.relation]}
                  </span>
                </p>
                {e.relation !== 'asserts' && <IndexNote node={p} />}
                {e.relation === 'unchecked' ? (
                  <p className="text-xs text-ink-muted">couldn't check: {reasonText(e.reason)}</p>
                ) : (
                  e.quote && (
                    <p className="font-serif text-[13px] italic text-ink-muted">
                      “{e.quote}” {e.page && <span className="not-italic">{e.page}</span>}
                    </p>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {contradicts && singleOrigin && (
        <div className="mt-4 rounded-lg bg-refutes-soft px-3 py-2 text-[13px] text-ink">
          One source holds it up, and a paper it cites doesn't contain the result — the claim inherits
          without new evidence.
        </div>
      )}
      <div className="mt-4 flex flex-col gap-1.5 text-sm">
        <button type="button" className="flex items-center gap-2 text-ink hover:text-accent"><FileText className="size-4" /> Show the deciding page</button>
        <button type="button" className="flex items-center gap-2 text-ink hover:text-accent"><Bookmark className="size-4" /> Add these {edges.length} to reading queue</button>
        <button type="button" className="flex items-center gap-2 text-ink hover:text-accent"><Copy className="size-4" /> Copy as related-work paragraph</button>
      </div>
    </aside>
  )
}

function PapersDetail({ graph, edge }: { graph: KnowledgeGraph; edge: PaperEdge }) {
  const node = (id: string) => graph.nodes.find((x) => x.id === id)
  const label = (id: string) => {
    const n = node(id)
    return n?.kind === 'paper' ? n.label : id
  }
  const a = label(edge.a)
  const b = label(edge.b)
  const outside = [edge.a, edge.b].filter((id) => {
    const n = node(id)
    return n?.kind === 'paper' && n.indexed === 'no'
  })
  const stats = [
    { value: edge.similarity.toFixed(2), label: edge.cites ? 'share of claims' : 'overlap' },
    { value: String(edge.citations), label: edge.cites ? 'claims citing it' : 'works both cite' },
    { value: String(edge.contradicted ?? 0), label: 'contradicted' },
  ]
  return (
    <aside className="w-full overflow-y-auto rounded-xl border border-border-subtle bg-surface p-5 lg:w-80 lg:shrink-0">
      <h2 className="font-serif text-lg font-semibold text-ink">{a} and {b}</h2>
      {outside.map((id) => (
        <p key={id} className="mt-1 text-xs font-medium text-insufficient">
          {label(id)} was not found in a public index
        </p>
      ))}
      <div className="mt-3 flex gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex-1 rounded-lg border border-border-subtle px-2.5 py-2">
            <p className="font-serif text-base font-semibold text-ink">{s.value}</p>
            <p className="text-[11px] text-ink-muted">{s.label}</p>
          </div>
        ))}
      </div>
      {edge.contradicted ? (
        <p className="mt-3 text-xs text-ink">
          <span className="mr-2 inline-block rounded bg-refutes-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-refutes">Refutes</span>
          {edge.contradicted} claim {a} makes about {b} is contradicted
        </p>
      ) : null}
      <p className="mt-4 text-xs font-semibold text-ink-muted">Closest passages</p>
      {edge.passages.length ? (
        <ul className="mt-2 flex flex-col gap-3">
          {edge.passages.map((p, i) => (
            <li key={i}>
              <p className="text-xs font-medium text-accent">{p.paper} {p.page}</p>
              <p className="font-serif text-[13px] italic text-ink-muted">“{p.quote}”</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-muted">No shared passages indexed for this pair yet.</p>
      )}
      <button type="button" className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-accent">
        <ExternalLink className="size-4" /> Open both side by side
      </button>
    </aside>
  )
}

export function Graph() {
  const graph = useKnowledgeGraph().data
  const { pal, dark } = usePalette()
  const cyRef = useRef<cytoscape.Core | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  // Cytoscape reads a pixel size once; in a flex column that size is wrong until the layout
  // settles (and again when the detail panel opens or the window resizes). Re-measure and re-fit
  // whenever the canvas box changes so the graph is never drawn off-screen or oversized.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const cy = cyRef.current
      if (!cy) return
      cy.resize()
      cy.fit(undefined, 40)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const params = new URLSearchParams(window.location.search)
  const [view, setView] = useState<View>(params.get('view') === 'papers' ? 'papers' : 'claims')
  const [claimSel, setClaimSel] = useState<string | null>(params.get('claim'))
  const [pairSel, setPairSel] = useState<string | null>(params.get('pair'))
  const [filter, setFilter] = useState('')
  const [pFilter, setPFilter] = useState<PapersFilter>('all')
  // Full label of the hovered node, positioned over the canvas — the on-node label is short.
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  const paperIds = useMemo(
    () => (graph ? new Set(graph.edges.map((e) => e.source)) : new Set<string>()),
    [graph],
  )

  const insights = useMemo(() => (graph ? computeInsights(graph) : []), [graph])

  const elements = useMemo(() => {
    if (!graph) return []
    if (view === 'claims') {
      const claimEdges: Record<string, GraphEdge[]> = {}
      graph.edges.forEach((e) => (claimEdges[e.target] ??= []).push(e))
      return [
        ...graph.nodes
          .filter((n) => n.kind === 'claim' || paperIds.has(n.id))
          .map((n) =>
            n.kind === 'paper'
              ? { data: { ...n, short: paperShort(n) } }
              : { data: { ...n, standing: claimStanding(claimEdges[n.id] ?? []) } },
          ),
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
    return [
      ...graph.nodes
        .filter((n) => n.kind === 'paper')
        .map((n) => ({ data: { ...n, weight: deg[n.id] ?? 1, short: paperShort(n) } })),
      ...edges.map((e) => ({
        data: { id: e.id, source: e.a, target: e.b, kind: 'paper', cites: e.cites ? 1 : 0, similarity: e.similarity },
      })),
    ]
  }, [graph, view, pFilter, paperIds])

  // Spotlight the selection's neighbourhood; fade the rest. Claims filter dims non-matches.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('faded selected')
      if (view === 'claims') {
        if (filter.trim()) {
          const q = filter.toLowerCase()
          cy.nodes('[kind="claim"]').forEach((n) => {
            if (!String(n.data('label')).toLowerCase().includes(q)) n.addClass('faded')
          })
        }
        if (claimSel) {
          const node = cy.$id(claimSel)
          if (node.nonempty()) {
            cy.elements().addClass('faded')
            node.closedNeighborhood().removeClass('faded')
            node.addClass('selected')
          }
        }
      } else if (pairSel) {
        const edge = cy.$id(pairSel)
        if (edge.nonempty()) {
          cy.elements().addClass('faded')
          edge.removeClass('faded').addClass('selected')
          edge.connectedNodes().removeClass('faded')
        }
      }
    })
  }, [view, filter, claimSel, pairSel, elements, ready])

  if (!graph) return null

  const title = view === 'claims' ? 'What rests on what' : 'How your library relates'
  const subtitle =
    view === 'claims'
      ? 'Claims and the papers that back, contradict, or ignore them. Click a claim to follow it back to the evidence it was born from.'
      : 'Dashed = a paper you analysed cites the other. Solid = two of your papers cite the same works. Thicker = more in common. Click a link to compare a pair.'
  const paperCount = graph.nodes.filter((n) => n.kind === 'paper').length
  const notIndexed = graph.nodes.filter((n) => n.kind === 'paper' && n.indexed === 'no').length
  const selectedEdge = pairSel ? graph.paperEdges.find((e) => e.id === pairSel) : undefined

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
          <p className="max-w-2xl text-sm text-ink-muted">{subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <div className="flex rounded-lg border border-border-subtle p-0.5 text-xs font-medium">
            {(['claims', 'papers'] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn('rounded-md px-3 py-1 capitalize', view === v ? 'bg-accent-soft text-ink' : 'text-ink-muted')}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'papers' && (
            <div className="flex flex-wrap gap-1.5 text-xs font-medium">
              {([['all', `All ${paperCount} papers`], ['strong', 'Strong links only'], ['citations', 'Citations']] as [PapersFilter, string][]).map(
                ([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPFilter(key)}
                    className={cn(
                      'rounded-lg border px-3 py-1',
                      pFilter === key ? 'border-accent bg-accent-soft text-ink' : 'border-border-subtle text-ink-muted',
                    )}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </header>

      {view === 'claims' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {insights.map((insight) => (
            <InsightTile key={insight.key} insight={insight} />
          ))}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        <div
          ref={canvasRef}
          className="relative h-[440px] min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-canvas lg:h-auto lg:min-h-0 lg:flex-1"
        >
          {/* Zoom + fit, so a dense library can be opened up and re-framed. factor 0 = fit. */}
          <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface">
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
                  if (!cy) return
                  if (factor === 0) cy.fit(undefined, 40)
                  else cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
                }}
                className="flex size-8 items-center justify-center text-ink-muted hover:bg-accent-soft hover:text-ink"
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          {view === 'claims' ? (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5">
              <Search className="size-3.5 text-ink-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter claims…"
                className="w-40 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
              />
            </div>
          ) : (
            <ClusterLegend pal={pal} clusters={graph.clusters} notIndexed={notIndexed} />
          )}
          <CytoscapeComponent
            key={`${view}-${dark}`}
            elements={elements}
            stylesheet={stylesheet(pal, graph.clusters, view)}
            layout={LAYOUT}
            style={{ width: '100%', height: '100%' }}
            cy={(cy: cytoscape.Core) => {
              cyRef.current = cy
              cy.removeAllListeners()
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
              // Full label on hover; drop it whenever the view moves so it can't hang stale.
              cy.on('mouseover', 'node', (evt: cytoscape.EventObject) => {
                const p = evt.target.renderedPosition()
                setTip({ x: p.x, y: p.y, text: String(evt.target.data('label')) })
              })
              cy.on('mouseout', 'node', () => setTip(null))
              cy.on('drag', 'node', () => setTip(null))
              cy.on('pan zoom', () => setTip(null))
              // The initial layout can run before the flex box has its final size (the ResizeObserver
              // races cy readiness), leaving the graph unfitted. Re-fit once cy is ready.
              requestAnimationFrame(() => {
                cy.resize()
                cy.fit(undefined, 40)
              })
              setReady(true)
            }}
          />
          {view === 'claims' && <ClaimsLegend pal={pal} notIndexed={notIndexed} />}
          {tip && (
            <div
              className="pointer-events-none absolute z-20 max-w-xs -translate-x-1/2 -translate-y-full rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs leading-snug text-ink shadow-lg"
              style={{ left: tip.x, top: tip.y - 10 }}
            >
              {tip.text}
            </div>
          )}
        </div>

        {view === 'claims' && claimSel && <ClaimDetail graph={graph} claimId={claimSel} pal={pal} />}
        {view === 'papers' && selectedEdge && <PapersDetail graph={graph} edge={selectedEdge} />}
      </div>
    </>
  )
}
