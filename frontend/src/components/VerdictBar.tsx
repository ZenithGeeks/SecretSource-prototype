/**
 * The verdict bar and its legend, for any role's redesign screen that counts citation verdicts
 * (#713): one stacked 8px bar sized by count, and the dots with counts beside it. Words and
 * colours come from src/lib/verdict.ts. Unavailable and unchecked citations are drawn and counted,
 * so a partly checked draft is never an all-green bar (the rule statusLabel follows, #727).
 */

import { cn } from '../lib/utils'
import { ALL_VERDICTS, VERDICTS } from '../lib/verdict'
import type { Verdict } from '../types/draftCheck'

/** One 8px bar, a segment per verdict in ALL_VERDICTS, sized by count. No citations yet draws
 * one muted track so the card keeps its shape. */
export function VerdictBar({ counts, className }: { counts: Record<Verdict, number>; className?: string }) {
  const segments = ALL_VERDICTS.filter((v) => counts[v] > 0)
  const total = segments.reduce((sum, v) => sum + counts[v], 0)
  return (
    <div
      role="img"
      aria-label={ALL_VERDICTS.map((v) => `${counts[v]} ${VERDICTS[v].legend}`).join(', ')}
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

/** Every judged verdict with its count, and the two absences when there are any. */
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
      {ALL_VERDICTS.filter((v) => VERDICTS[v].standing !== 'unchecked' || counts[v] > 0).map((v) => (
        <li key={v} className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className={cn('inline-block size-2 rounded-full', VERDICTS[v].fill)} />
          {counts[v]} {VERDICTS[v].legend}
        </li>
      ))}
    </ul>
  )
}
