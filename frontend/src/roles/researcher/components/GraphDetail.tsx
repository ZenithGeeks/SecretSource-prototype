/**
 * The detail panels beside the graph canvas (Figma: Graph · Claims "claim detail", Graph · Papers
 * "pair detail"). A claim shows its standing, the sentence, where it comes from, and what each
 * other paper says. A pair of papers shows how they relate and the passages that link them.
 * "Copy evidence" is an icon button in the claim header.
 */

import { Copy, ExternalLink, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { VerdictBadge } from '../../../components/ui'
import type { Standing } from '../../../lib/claims'
import { reasonText } from '../../../lib/api'
import type { GraphEdge, GraphNode, GraphRelation, KnowledgeGraph, PaperEdge } from '../../../lib/researcher'

const RELATION_LABEL: Record<GraphRelation, string> = {
  asserts: 'asserts', backs: 'backs', contradicts: 'contradicts', silent: 'silent', unchecked: "couldn't check",
}

const RELATION_STANDING: Record<GraphRelation, Standing> = {
  asserts: 'unchecked', backs: 'supports', contradicts: 'refutes', silent: 'insufficient', unchecked: 'unchecked',
}

const PANEL =
  'flex w-full flex-col gap-4 overflow-y-auto rounded-2xl border border-border-subtle bg-surface p-5 shadow-[0_8px_12px_rgba(31,20,36,0.05),0_1px_1px_rgba(31,20,36,0.04)] lg:w-[360px] lg:shrink-0'

const ICON_BUTTON =
  'flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-muted hover:bg-accent-soft hover:text-ink'

/** The overall standing of a claim, from the edges that cite it: contradicted, then silent, then backed. */
function standingOf(edges: GraphEdge[]): Standing {
  if (edges.some((e) => e.relation === 'contradicts')) return 'refutes'
  if (edges.some((e) => e.relation === 'silent')) return 'insufficient'
  if (edges.some((e) => e.relation === 'backs')) return 'supports'
  return 'unchecked'
}

/** Under a cited work: which index knew it, or that none did. */
function IndexNote({ node }: { node: GraphNode | undefined }) {
  if (node?.kind !== 'paper' || !node.indexed) return null
  return node.indexed === 'no' ? (
    <p className="text-xs font-medium text-insufficient">Not found in a public index</p>
  ) : (
    <p className="text-xs text-ink-muted">Found in {node.index || 'a public index'}</p>
  )
}

function Quote({ children }: { children: ReactNode }) {
  return <p className="font-serif text-[14px] leading-[21px] italic text-ink">{children}</p>
}

function Cited({ quote, page }: { quote?: string; page?: string }) {
  if (!quote) return null
  return (
    <Quote>
      “{quote}”{page && <span className="ml-1 text-ink-muted not-italic">{page}</span>}
    </Quote>
  )
}

export function GraphClaimDetail({ graph, claimId, onClose }: { graph: KnowledgeGraph; claimId: string; onClose: () => void }) {
  const claim = graph.nodes.find((n) => n.id === claimId)
  const edges = graph.edges.filter((e) => e.target === claimId)
  const paper = (id: string) => graph.nodes.find((n) => n.id === id)
  const [copied, setCopied] = useState(false)
  if (!claim || claim.kind !== 'claim') return null
  const contradicts = edges.some((e) => e.relation === 'contradicts')
  const origins = edges.filter((e) => e.relation === 'asserts')
  const others = edges.filter((e) => e.relation !== 'asserts')
  const name = (id: string) => {
    const p = paper(id)
    return p?.kind === 'paper' ? `${p.label}${p.year ? ` ${p.year}` : ''}` : id
  }

  const copyEvidence = async () => {
    const lines = others
      .filter((e) => e.quote)
      .map((e) => `${name(e.source)} — ${RELATION_LABEL[e.relation]}: "${e.quote}"`)
    await navigator.clipboard.writeText([claim.label, ...lines].join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <aside aria-label="Claim detail" className={PANEL}>
      <div className="flex items-center gap-2">
        <VerdictBadge verdict={standingOf(edges)} />
        <span className="flex-1" />
        <button type="button" onClick={copyEvidence} aria-label="Copy evidence" title={copied ? 'Copied' : 'Copy evidence'} className={ICON_BUTTON}>
          <Copy className="size-4" />
        </button>
        <button type="button" onClick={onClose} aria-label="Close" title="Close" className={ICON_BUTTON}>
          <X className="size-4" />
        </button>
      </div>
      <h2 className="text-[17px] leading-6 font-medium text-ink">{claim.label}</h2>

      <p className="type-label text-ink-muted">Where it comes from</p>
      <div className="flex flex-col gap-3 rounded-[10px] bg-neutral-soft px-3 py-2.5">
        {origins.length === 0 && <p className="text-xs text-ink-muted">No origin recorded.</p>}
        {origins.map((e) => (
          <div key={e.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[13px] leading-[18px] font-medium text-ink">{name(e.source)}</span>
              <VerdictBadge verdict="uncited" text="origin" />
            </div>
            <Cited quote={e.quote} page={e.page} />
          </div>
        ))}
      </div>

      {others.length > 0 && <p className="type-label text-ink-muted">What the other papers say</p>}
      <div className="flex flex-col">
        {others.map((e) => (
          <div key={e.id} className="flex flex-col gap-1.5 border-t border-border-subtle py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-ink">{name(e.source)}</span>
              <VerdictBadge verdict={RELATION_STANDING[e.relation]} />
            </div>
            <IndexNote node={paper(e.source)} />
            {e.relation === 'unchecked' ? (
              <p className="text-xs text-ink-muted">couldn't check: {reasonText(e.reason)}</p>
            ) : (
              <Cited quote={e.quote} page={e.page} />
            )}
          </div>
        ))}
      </div>
      {contradicts && origins.length <= 1 && (
        <div className="rounded-[10px] bg-refutes-soft px-3 py-2 text-[13px] text-ink">
          One source holds it up, and a paper it cites doesn't contain the result — the claim inherits
          without new evidence.
        </div>
      )}
    </aside>
  )
}

export function GraphPairDetail({ graph, edge, onClose }: { graph: KnowledgeGraph; edge: PaperEdge; onClose: () => void }) {
  const node = (id: string) => graph.nodes.find((x) => x.id === id)
  const label = (id: string) => {
    const n = node(id)
    return n?.kind === 'paper' ? `${n.label}${n.year ? ` ${n.year}` : ''}` : id
  }
  const outside = [edge.a, edge.b].filter((id) => {
    const n = node(id)
    return n?.kind === 'paper' && n.indexed === 'no'
  })
  const relation = edge.cites
    ? `One cites the other · ${edge.citations} ${edge.citations === 1 ? 'claim cites' : 'claims cite'} it`
    : `${edge.citations} cited ${edge.citations === 1 ? 'work' : 'works'} in common`

  return (
    <aside aria-label="Pair detail" className={PANEL}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[15px] leading-[21px] font-semibold text-ink">
          {label(edge.a)} <span className="font-normal text-ink-muted">↔</span> {label(edge.b)}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" title="Close" className={ICON_BUTTON}>
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[13px] leading-[18px] text-ink-muted">{relation}</p>
      {outside.map((id) => (
        <p key={id} className="text-xs font-medium text-insufficient">
          {label(id)} was not found in a public index
        </p>
      ))}
      {edge.contradicted ? (
        <div className="flex items-center gap-2 text-xs text-ink">
          <VerdictBadge verdict="refutes" text="Refutes" />
          {edge.contradicted} {edge.contradicted === 1 ? 'claim is' : 'claims are'} contradicted
        </div>
      ) : null}
      <p className="type-label text-ink-muted">Closest passages</p>
      {edge.passages.length ? (
        <div className="flex flex-col gap-2 rounded-xl bg-neutral-soft p-3">
          {edge.passages.map((p, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p className="type-label text-ink-muted">
                {p.paper}
                {p.page && ` · ${p.page}`}
              </p>
              <Quote>“{p.quote}”</Quote>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">No shared passages indexed for this pair yet.</p>
      )}
      <button
        type="button"
        onClick={() => {
          for (const id of [edge.a, edge.b]) {
            window.open(`${window.location.pathname}?screen=analyses&analysis=${id.replace(/^a:/, '')}`, '_blank')
          }
        }}
        className="flex items-center gap-2 text-sm text-ink hover:text-accent"
      >
        <ExternalLink className="size-4" /> Open both side by side
      </button>
    </aside>
  )
}
