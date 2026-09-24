/**
 * The verdict visuals every Author screen shares, all reading src/lib/verdict.ts:
 * CitationBadge (the pill on an issue row), VerdictBar (the stacked bar) and VerdictLegend
 * (the dots with counts — Draft check's legend and the editor's status bar).
 */

import { StandingBadge } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import { VERDICTS, VERDICT_ORDER } from '../../../lib/verdict'
import type { Verdict } from '../../../types/draftCheck'

export function CitationBadge({ verdict }: { verdict: Verdict }) {
  return <StandingBadge standing={VERDICTS[verdict].standing} title={VERDICTS[verdict].legend} />
}

/** One 8px bar, a segment per verdict in VERDICT_ORDER, sized by count. Nothing checked yet
 * draws one muted track so the card keeps its shape. */
export function VerdictBar({ counts, className }: { counts: Record<Verdict, number>; className?: string }) {
  const segments = VERDICT_ORDER.filter((v) => counts[v] > 0)
  const total = segments.reduce((sum, v) => sum + counts[v], 0)
  return (
    <div
      role="img"
      aria-label={VERDICT_ORDER.map((v) => `${counts[v]} ${VERDICTS[v].legend}`).join(', ')}
      className={cn('flex h-2 w-full gap-0.5', className)}
    >
      {total === 0 ? (
        <div className="h-2 flex-1 rounded-sm bg-border-subtle" />
      ) : (
        segments.map((v) => (
          <div
            key={v}
            className={cn('h-2 min-w-px rounded-sm', VERDICTS[v].fill)}
            style={{ flexGrow: counts[v], flexBasis: 0 }}
          />
        ))
      )}
    </div>
  )
}

export function VerdictLegend({
  counts,
  className,
  gap = 'gap-3.5',
}: {
  counts: Record<Verdict, number>
  className?: string
  gap?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center text-xs text-ink-muted', gap, className)}>
      {VERDICT_ORDER.map((v) => (
        <li key={v} className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className={cn('inline-block size-[7px] rounded-full', VERDICTS[v].fill)} />
          {counts[v]} {VERDICTS[v].legend}
        </li>
      ))}
    </ul>
  )
}
