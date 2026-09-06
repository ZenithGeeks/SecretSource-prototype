import type { Claim } from './claim'
import type { Draft } from './draft'

/** A draft plus the claims still needing attention, worst (or next) issue first. */
export interface CheckRun {
  draft: Draft
  issues: Claim[]
  currentIssueIndex: number
}
