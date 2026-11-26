/**
 * The detail panels beside the graph canvas (Figma: Graph · Claims "claim detail", Graph · Papers
 * "pair detail"). A claim shows its standing, the sentence, where it comes from, and what each
 * other paper says. A pair of papers shows how they relate and the passages that link them.
 * "Copy evidence" is an icon button in the claim header.
 */

import { Copy, ExternalLink, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { IconButton, VerdictBadge } from '../../../components/ui'
import type { Standing } from '../../../lib/claims'
import { reasonText } from '../../../lib/api'
import { type GraphEdge, type GraphNode, type GraphRelation, type KnowledgeGraph, type PaperEdge, RELATION_STANDING } from '../../../lib/researcher'

const RELATION_LABEL: Record<GraphRelation, string> = {
  asserts: 'asserts', backs: 'backs', contradicts: 'contradicts', silent: 'silent', unchecked: "couldn't check",
}

const PANEL =
  'flex w-full flex-col gap-4 overflow-y-auto rounded-2xl border border-border-subtle bg-surface p-5 shadow-card lg:w-90 lg:shrink-0'

/** Puts focus on a detail panel when it opens or shows another item, so a keyboard or screen reader
 * user lands in what they just chose instead of staying on the canvas. */
function useFocusOnOpen(key: string) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => panel.current?.focus(), [key])
  return panel
}

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
  return <p className="font-serif text-[14px] leading-5.5 italic text-ink">{children}</p>
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
  const panel = useFocusOnOpen(claimId)
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
    try {
      // navigator.clipboard is missing on a page served over plain http.
      await navigator.clipboard.writeText([claim.label, ...lines].join('\n\n'))
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <aside ref={panel} tabIndex={-1} aria-label="Claim detail" className={PANEL}>
      <div className="flex items-center gap-2">
        <VerdictBadge verdict={standingOf(edges)} />
        <span className="flex-1" />
        <IconButton onClick={copyEvidence} aria-label="Copy evidence" title={copied ? 'Copied' : 'Copy evidence'} className="size-8 rounded-lg pointer-coarse:size-11">
          <Copy className="size-4" />
        </IconButton>
        <IconButton onClick={onClose} aria-label="Close" title="Close" className="size-8 rounded-lg pointer-coarse:size-11">
          <X className="size-4" />
        </IconButton>
      </div>
      <h2 className="text-[17px] leading-6 font-medium text-ink">{claim.label}</h2>

      <p className="type-label text-ink-muted">Where it comes from</p>
      <div className="flex flex-col gap-3 rounded-lg bg-neutral-soft px-3 py-2.5">
        {origins.length === 0 && <p className="text-xs text-ink-muted">No origin recorded.</p>}
        {origins.map((e) => (
          <div key={e.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-ui leading-4.5 font-medium text-ink">{name(e.source)}</span>
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
              <span className="min-w-0 flex-1 text-ui leading-4.5 font-medium text-ink">{name(e.source)}</span>
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
        <div className="rounded-lg bg-refutes-soft px-3 py-2 text-ui text-ink">
          One source holds it up, and a paper it cites doesn't contain the result — the claim inherits
          without new evidence.
        </div>
      )}
    </aside>
  )
}

export function GraphPairDetail({ graph, edge, onClose }: { graph: KnowledgeGraph; edge: PaperEdge; onClose: () => void }) {
  const panel = useFocusOnOpen(edge.id)
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
    <aside ref={panel} tabIndex={-1} aria-label="Pair detail" className={PANEL}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-reading leading-5.5 font-semibold text-ink">
          {label(edge.a)} <span aria-hidden="true" className="font-normal text-ink-muted">↔</span> {label(edge.b)}
        </h2>
        <IconButton onClick={onClose} aria-label="Close" title="Close" className="size-8 rounded-lg pointer-coarse:size-11">
          <X className="size-4" />
        </IconButton>
      </div>
      <p className="text-ui leading-4.5 text-ink-muted">{relation}</p>
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
        <p className="text-ui text-ink-muted">No shared passages indexed for this pair yet.</p>
      )}
      {/* Two links, not two window.open calls: a browser lets only the first of those through. */}
      <div className="flex flex-col gap-1.5">
        {[edge.a, edge.b].map((id) => (
          <a
            key={id}
            href={`${window.location.pathname}?role=researcher&screen=analyses&analysis=${id.replace(/^a:/, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-ink hover:text-accent"
          >
            <ExternalLink aria-hidden="true" className="size-4 shrink-0" /> Open {label(id)} in a new tab
          </a>
        ))}
      </div>
    </aside>
  )
}
