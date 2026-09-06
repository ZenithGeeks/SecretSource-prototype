import type { Citation } from './citation'
import type { Source } from './source'
import type { VerdictKind } from './verdict'

/**
 * One claim in a draft or paper, and how its citation stood up.
 * `citation` absent = nothing was cited (uncited). `verdict` absent = not checked yet.
 */
export interface Claim {
  id: string
  text: string
  citation?: Citation
  verdict?: VerdictKind
  explanation?: string
  quote?: string
  quoteLocation?: string
  suggestion?: Source
}

/** A claim known to have a verdict — the shape of a draft's "needs work" issues. */
export interface Issue extends Claim {
  verdict: VerdictKind
}

export function hasVerdict(claim: Claim): claim is Issue {
  return claim.verdict === 'refutes' || claim.verdict === 'insufficient'
}
