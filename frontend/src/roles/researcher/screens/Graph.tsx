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
import { AlertCircle, CheckCircle2, Copy, ExternalLink, FileText, GitFork, HelpCircle, Maximize, Maximize2, Minimize, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'

import { Empty, LoadingScreen } from '../../../components/ui'
import { reasonText } from '../../../lib/api'
import type { GraphEdge, GraphNode, GraphRelation, KnowledgeGraph, PaperEdge } from '../../../lib/researcher'
import { useSettings } from '../../../lib/settings'
import { FieldConsensus } from './FieldConsensus'
import { useKnowledgeGraph } from '../../../lib/useResearcher'
import { fitReadable } from '../../../lib/graphFit'
import { cn } from '../../../lib/utils'

let _colaReady = false
if (!_colaReady) {
  try {
    cytoscape.use(cola)
  } catch {
    /* already registered */
  }
  _colaReady = true
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
        width: 2,
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
  const [copied, setCopied] = useState(false)
  if (!claim || claim.kind !== 'claim') return null
  const contradicts = edges.some((e) => e.relation === 'contradicts')
  const singleOrigin = edges.filter((e) => e.relation === 'asserts').length <= 1

  const copyParagraph = async () => {
    const p = (id: string) => paper(id)
    const lines = edges
      .filter((e) => e.relation !== 'asserts' && e.quote)
      .map((e) => {
        const node = p(e.source)
        const label = node?.kind === 'paper' ? node.label : e.source
        return `${label} — ${RELATION_LABEL[e.relation]}: "${e.quote}"`
      })
    await navigator.clipboard.writeText([claim.label, ...lines].join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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
        <button
          type="button"
          onClick={() => {
            const deciding = edges.find((e) => e.relation !== 'asserts') ?? edges[0]
            if (!deciding) return
            const id = deciding.source.replace(/^a:/, '')
            window.open(`${window.location.pathname}?screen=analyses&analysis=${id}`, '_blank')
          }}
          className="flex items-center gap-2 text-ink hover:text-accent"
        >
          <FileText className="size-4" /> Show the deciding page
        </button>
        <button type="button" onClick={copyParagraph} className="flex items-center gap-2 text-ink hover:text-accent">
          <Copy className="size-4" /> {copied ? 'Copied ✓' : 'Copy as related-work paragraph'}
        </button>
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
      <button
        type="button"
        onClick={() => {
          const idA = edge.a.replace(/^a:/, '')
          const idB = edge.b.replace(/^a:/, '')
          window.open(`${window.location.pathname}?screen=analyses&analysis=${idA}`, '_blank')
          window.open(`${window.location.pathname}?screen=analyses&analysis=${idB}`, '_blank')
        }}
        className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-accent"
      >
        <ExternalLink className="size-4" /> Open both side by side
      </button>
    </aside>
  )
}

/** What a role shows in place of an empty canvas; a role that passes none gets the canvas. */
export type GraphEmptyMessage = { title: string; hint: string }

function GraphCanvas({ emptyMessage }: { emptyMessage?: GraphEmptyMessage }) {
  const { data: graph, isError } = useKnowledgeGraph()
  const { pal } = usePalette()
  const cyRef = useRef<cytoscape.Core | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [ready, setReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

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

  // Keep fullscreen state in sync (Esc also exits) and re-fit when the canvas resizes into or out
  // of fullscreen.
  useEffect(() => {
    const onChange = () => {
      setFullscreen(Boolean(document.fullscreenElement))
      const cy = cyRef.current
      if (cy) {
        cy.resize()
        cy.fit(undefined, 40)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const params = new URLSearchParams(window.location.search)
  const [view, setView] = useState<View>(params.get('view') === 'papers' ? 'papers' : 'claims')
  const [claimSel, setClaimSel] = useState<string | null>(params.get('claim'))
  const [pairSel, setPairSel] = useState<string | null>(params.get('pair'))
  const [filter, setFilter] = useState('')
  const [pFilter, setPFilter] = useState<PapersFilter>('all')
  // Full label of the hovered node, positioned over the canvas — the on-node label is short.
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  // The hovered node id: like Obsidian, hovering spotlights that node's neighbours and dims the rest.
  const [hovered, setHovered] = useState<string | null>(null)

  const paperIds = useMemo(
    () => (graph ? new Set(graph.edges.map((e) => e.source)) : new Set<string>()),
    [graph],
  )

  const insights = useMemo(() => (graph ? computeInsights(graph) : []), [graph])

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
              ? { ...n, short: paperShort(n), weight: deg[n.id] ?? 1 }
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
  }, [view, filter, claimSel, pairSel, hovered, elements, ready])

  // Recolour the existing graph on a theme change instead of rebuilding it. The CytoscapeComponent
  // key is `view` only (not the theme), so flipping light/dark keeps the instance and the user's
  // zoom, pan and dragged positions — this just re-applies the palette to the live stylesheet.
  useEffect(() => {
    const cy = cyRef.current
    if (cy && graph) cy.style(stylesheet(pal, graph.clusters, view))
  }, [pal, view, graph])

  if (isError) return <Empty title="The graph could not load" hint="Refresh the page to try again." />
  if (!graph) return <LoadingScreen label="Loading the graph…" />
  if (emptyMessage && graph.nodes.length === 0) return <Empty title={emptyMessage.title} hint={emptyMessage.hint} />

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

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
        {/* This screen is only the graph, so give the canvas the viewport height (height is the
            binding constraint for fitting the whole graph), with a min so it can't collapse on a
            short window. The role shell is `wide` for Graph, so it also uses the screen width. */}
        <div
          ref={setCanvas}
          className="relative min-h-[560px] min-w-0 flex-1 overflow-hidden rounded-xl border border-border-subtle bg-canvas lg:h-[calc(100dvh-13rem)]"
        >
          {/* Zoom, fit and fullscreen, so a dense library can be opened up and re-framed. */}
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
            <button
              type="button"
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen()
                else void canvasRef.current?.requestFullscreen?.()
              }}
              className="flex size-8 items-center justify-center border-t border-border-subtle text-ink-muted hover:bg-accent-soft hover:text-ink"
            >
              {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </button>
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
              setReady(true)
            }}
          />
          {view === 'claims' && <ClaimsLegend pal={pal} notIndexed={notIndexed} />}
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

        {view === 'claims' && claimSel && <ClaimDetail graph={graph} claimId={claimSel} pal={pal} />}
        {view === 'papers' && selectedEdge && <PapersDetail graph={graph} edge={selectedEdge} />}
      </div>
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
}: {
  onOpenAnalysis: (id: string) => void
  initialTab?: 'graph' | 'consensus'
  emptyMessage?: GraphEmptyMessage
}) {
  const [tab, setTab] = useState<'graph' | 'consensus'>(initialTab)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-1 self-start rounded-xl border border-border-subtle bg-surface p-1">
        {(['graph', 'consensus'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t === 'graph' ? 'Graph' : 'Field Consensus'}
          </button>
        ))}
      </div>
      {tab === 'graph' ? <GraphCanvas emptyMessage={emptyMessage} /> : <FieldConsensus onOpenAnalysis={onOpenAnalysis} />}
    </div>
  )
}
