/**
 * The two canvas legends (Figma: Graph, overlay/legend). Claims: what a claim dot's colour and an
 * edge's line style mean. Papers: the cluster colours and what a link's weight and dashes mean.
 * Colours arrive as hex because the canvas is drawn by Cytoscape, which cannot read CSS variables.
 */

import type { ReactNode } from 'react'

import { cn } from '../../../lib/utils'

export type LegendColors = { supports: string; refutes: string; insufficient: string; inkMuted: string; accent: string; border: string }

const BOX =
  'absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-1.5 rounded-[10px] border border-border-subtle bg-surface px-3 py-2.5'
const ROW = 'flex flex-wrap items-center gap-x-3 gap-y-1'

function Name({ children }: { children: string }) {
  return <span className="type-label text-ink-muted">{children}</span>
}

function Item({ children, mark }: { children: string; mark: ReactNode }) {
  return (
    <span className="flex items-center gap-[5px] text-xs text-ink-muted">
      {mark}
      {children}
    </span>
  )
}

function Dot({ color, className = 'size-2' }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('rounded-full', className)} style={{ backgroundColor: color }} />
}

function Line({ color, style, thick }: { color: string; style?: 'dashed' | 'dotted'; thick?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-4"
      style={{ borderTopColor: color, borderTopStyle: style ?? 'solid', borderTopWidth: thick ? 4 : 2 }}
    />
  )
}

function NotIndexed({ color, count }: { color: string; count: number }) {
  if (count === 0) return null
  return (
    <span
      className="flex items-center gap-[5px] text-xs text-ink-muted"
      title="Semantic Scholar, arXiv and Unpaywall found nothing for this reference as it is written. This is not a Scopus check."
    >
      <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-dashed" style={{ borderColor: color }} />
      {count} not in a public index
    </span>
  )
}

export function GraphClaimsLegend({ colors, notIndexed }: { colors: LegendColors; notIndexed: number }) {
  return (
    <div className={BOX}>
      <div className={ROW}>
        <Name>Claim</Name>
        <Item mark={<Dot color={colors.refutes} />}>contradict</Item>
        <Item mark={<Dot color={colors.insufficient} />}>silent</Item>
        <Item mark={<Dot color={colors.supports} />}>back it</Item>
        <Item mark={<Dot color={colors.inkMuted} />}>not checked</Item>
      </div>
      <div className={ROW}>
        <Name>Edge</Name>
        <Item mark={<Line color={colors.supports} />}>backs it</Item>
        <Item mark={<Line color={colors.refutes} />}>contradicts</Item>
        <Item mark={<Line color={colors.inkMuted} style="dashed" />}>origin</Item>
        <Item mark={<Line color={colors.inkMuted} style="dotted" />}>not checked</Item>
        <NotIndexed color={colors.insufficient} count={notIndexed} />
      </div>
    </div>
  )
}

export function GraphPapersLegend({
  colors,
  clusters,
  clusterColors,
  notIndexed,
}: {
  colors: LegendColors
  clusters: string[]
  clusterColors: string[]
  notIndexed: number
}) {
  return (
    <div className={BOX}>
      <div className={ROW}>
        <Name>Cluster</Name>
        {clusters.map((c, i) => (
          <Item key={c} mark={<Dot color={clusterColors[i % clusterColors.length]} className="size-2.5" />}>
            {c}
          </Item>
        ))}
        <NotIndexed color={colors.insufficient} count={notIndexed} />
      </div>
      <div className={ROW}>
        <Name>Link</Name>
        <Item mark={<Line color={colors.border} />}>cite the same works</Item>
        <Item mark={<Line color={colors.accent} thick />}>more in common</Item>
        <Item mark={<Line color={colors.border} style="dashed" />}>one cites the other</Item>
      </div>
    </div>
  )
}
