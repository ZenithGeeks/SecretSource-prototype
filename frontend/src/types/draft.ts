import type { VerdictKind } from './verdict'

export type DraftMark = VerdictKind

export interface DraftWord {
  text: string
  mark?: DraftMark
}

export interface Draft {
  id: string
  fileName: string
  heading: string
  paragraphs: DraftWord[][]
  citationsFound: number
  issuesRemaining: number
  lastCheckedLabel: string // "checked 2h ago"
}
