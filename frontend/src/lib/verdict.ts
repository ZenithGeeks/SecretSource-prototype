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
  // Not an open issue: nothing was judged, so there is nothing to replace or override. The
  // Library's "Needs attention" lists it instead, with "Upload PDF" (same rule as the gateway).
  unavailable: {
    badge: 'Not checked',
    legend: 'unavailable',
    standing: 'unchecked',
    text: 'text-ink-muted',
    fill: 'bg-ink-muted',
    soft: 'bg-canvas text-ink-muted',
    needsWork: false,
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

/** A verdict the check is not sure of: the source was silent on the sentence, the judge
 * answered without a passage to point at, or the gateway's audit flagged it (a quote that is
 * not in the source passages). */
export function isLowConfidence(c: Pick<Citation, 'verdict' | 'evidence' | 'audit'>): boolean {
  if (c.verdict === 'insufficient' || c.audit?.length) return true
  return (c.verdict === 'supports' || c.verdict === 'refutes') && !c.evidence?.passage
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

/** Citations the check could not judge: the source was unavailable, or (the only way a
 * finished Author check leaves one unchecked) the \cite key is missing from the .bib. */
function unjudged(status: DraftStatus): number {
  return status.counts.unavailable + status.counts.unchecked
}

/** "3 issues" · "1 unavailable · 1 not checked" · "all supported" · "no open issues" ·
 * "2 not checked" · "not checked" — the words next to a draft in "Your drafts". "all
 * supported" only when every citation is supported (#727): an unread source, a missing key or
 * a contradiction the author kept is never called supported. A check whose every key was
 * missing says how many it could not check, not that no check ran. isOpenIssue is unchanged,
 * so "issues" counts what it did. Same rule as status_label in backend/app/author/logic.py. */
export function statusLabel(status: DraftStatus): string {
  if (status.checked === 0) return status.counts.unchecked ? `${status.counts.unchecked} not checked` : 'not checked'
  if (status.open) return `${status.open} issue${status.open === 1 ? '' : 's'}`
  if (unjudged(status)) {
    const { unavailable, unchecked } = status.counts
    return [unavailable && `${unavailable} unavailable`, unchecked && `${unchecked} not checked`].filter(Boolean).join(' · ')
  }
  if (status.counts.supports === status.checked) return 'all supported'
  return 'no open issues'
}

/** The colour of that label, by the same counts: red while something needs work, green only
 * when every citation is supported, neutral otherwise (#727). */
export function statusTone(status: DraftStatus): string {
  if (status.open) return 'text-refutes'
  if (status.checked && !unjudged(status) && status.counts.supports === status.checked) return 'text-supports'
  return 'text-ink-muted'
}

/** The sentence under "Nothing needs work" / "No open issues": what the counts say, never
 * more. */
export function settledHint(status: DraftStatus): string {
  const { unavailable, unchecked } = status.counts
  const total = unavailable + unchecked
  if (total) {
    const why = [
      unavailable && `${unavailable} source${unavailable === 1 ? '' : 's'} unavailable`,
      unchecked && `${unchecked} key${unchecked === 1 ? '' : 's'} missing from the .bib`,
    ].filter(Boolean)
    return `${total} citation${total === 1 ? '' : 's'} couldn't be checked: ${why.join(', ')}.`
  }
  if (status.checked === 0) return 'Re-check to verify every \\cite against its source.'
  if (status.counts.supports === status.checked) return 'Every checked citation holds up.'
  return 'Every citation that needed work is resolved.'
}

/** What to show after a counts line that already ends with "· N unavailable" (check history,
 * report header): the label without that repeat, or null when nothing is left to say. */
export function labelAfterCounts(status: DraftStatus): string | null {
  if (status.checked === 0 || status.open || !status.counts.unavailable) return statusLabel(status)
  return status.counts.unchecked ? `${status.counts.unchecked} not checked` : null
}

/** A project card's tally as one draft status, so a project is labelled by the same rule. */
export function projectStatus(project: { tally: Record<Verdict, number>; needWork: number }): DraftStatus {
  const checked = Object.values(project.tally).reduce((sum, n) => sum + n, 0) - project.tally.unchecked
  return { checked, counts: project.tally, open: project.needWork }
}
