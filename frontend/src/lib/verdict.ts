/**
 * The single mapping from a `Verdict` to its words and colours. Every Author screen (Draft
 * check badges and legend, the editor's gutter, status bar and popover, the export report)
 * reads this, so a verdict is always called and coloured the same way.
 *
 * Colours are the index.css tokens: supports / refutes / insufficient own a colour; the two
 * "no answer" verdicts (unavailable, unchecked) stay neutral, because an absence is not a
 * finding (same rule as StandingBadge in components/ui.tsx).
 */

import type { Citation, DraftStatus, Verdict } from '../types/draftCheck'

export type VerdictMeta = {
  /** Badge text: "Source contradicts". Same words as StandingBadge. */
  badge: string
  /** Legend / status-bar text: "not supported". */
  legend: string
  /** The StandingBadge kind that renders this verdict, so the existing badge is reused. */
  standing: 'supports' | 'refutes' | 'insufficient' | 'unchecked'
  /** Tailwind token classes. */
  text: string
  fill: string
  soft: string
  /** True when the author should do something about it. */
  needsWork: boolean
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
  supports: {
    badge: 'Source backs it',
    legend: 'supported',
    standing: 'supports',
    text: 'text-supports',
    fill: 'bg-supports',
    soft: 'bg-supports-soft text-supports',
    needsWork: false,
  },
  insufficient: {
    badge: 'Source is silent',
    legend: 'partial',
    standing: 'insufficient',
    text: 'text-insufficient',
    fill: 'bg-insufficient',
    soft: 'bg-insufficient-soft text-insufficient',
    needsWork: true,
  },
  refutes: {
    badge: 'Source contradicts',
    legend: 'not supported',
    standing: 'refutes',
    text: 'text-refutes',
    fill: 'bg-refutes',
    soft: 'bg-refutes-soft text-refutes',
    needsWork: true,
  },
  unavailable: {
    badge: 'Not checked',
    legend: 'unavailable',
    standing: 'unchecked',
    text: 'text-ink-muted',
    fill: 'bg-ink-muted',
    soft: 'bg-canvas text-ink-muted',
    needsWork: true,
  },
  unchecked: {
    badge: 'Not checked',
    legend: 'not checked',
    standing: 'unchecked',
    text: 'text-ink-muted',
    fill: 'bg-ink-muted',
    soft: 'bg-canvas text-ink-muted',
    needsWork: false,
  },
}

/** The order the stacked bar, the legend and the status bar list verdicts in (Figma). */
export const VERDICT_ORDER: readonly Verdict[] = ['supports', 'insufficient', 'refutes', 'unavailable']

export const ALL_VERDICTS: readonly Verdict[] = [...VERDICT_ORDER, 'unchecked']

export function emptyCounts(): Record<Verdict, number> {
  return { supports: 0, insufficient: 0, refutes: 0, unavailable: 0, unchecked: 0 }
}

/** A citation the author still has to deal with: needs work and not yet replaced/overridden. */
export function isOpenIssue(citation: Pick<Citation, 'verdict' | 'resolution'>): boolean {
  return VERDICTS[citation.verdict].needsWork && !citation.resolution
}

/** Counts every verdict once, plus how many were checked at all and how many are open. */
export function summarize(citations: Pick<Citation, 'verdict' | 'resolution'>[]): DraftStatus {
  const counts = emptyCounts()
  let open = 0
  for (const c of citations) {
    counts[c.verdict] += 1
    if (isOpenIssue(c)) open += 1
  }
  return { checked: citations.length - counts.unchecked, counts, open }
}

/** "3 issues" · "all supported" · "not checked" — the word next to a draft in "Your drafts". */
export function statusLabel(status: DraftStatus): string {
  if (status.checked === 0) return 'not checked'
  if (status.open === 0) return 'all supported'
  return `${status.open} issue${status.open === 1 ? '' : 's'}`
}
