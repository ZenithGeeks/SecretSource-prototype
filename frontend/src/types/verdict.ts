/** How a source answers a claim. Mirrors the researcher app's Verdict.verdict (lib/api.ts). */
export type VerdictKind = 'supports' | 'refutes' | 'insufficient'

/** Writer-facing standing: a verdict, plus the two non-answers (nothing to check / not checked yet). */
export type WriterStanding = VerdictKind | 'unchecked' | 'uncited'

export const VERDICT_BADGE_TEXT: Record<VerdictKind, string> = {
  supports: 'SOURCE BACKS IT',
  refutes: 'SOURCE CONTRADICTS',
  insufficient: 'SOURCE IS SILENT',
}

export const VERDICT_LEGEND_TEXT: Record<VerdictKind, string> = {
  supports: 'source backs it',
  refutes: 'source contradicts',
  insufficient: 'source is silent',
}
