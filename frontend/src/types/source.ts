import type { VerdictKind } from './verdict'

/** A candidate source: a work that may (or does) back, contradict, or stay silent on a claim. */
export interface Source {
  id: string
  citation: string // "Santhanam et al. (2022)"
  title: string
  venue?: string
  verdict: VerdictKind
  similarity: number // 0..1, cosine match to the searched claim
  location: string // "p.4 §3.2"
  quote: string
  inLibrary: boolean
  openAccess: boolean
  isCurrentCitation: boolean
  isBestMatch: boolean
}
