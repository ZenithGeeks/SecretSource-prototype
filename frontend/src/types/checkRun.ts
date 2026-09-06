import type { Draft } from './draft'
import type { Issue } from './claim'

/** A draft plus the claims still needing attention, worst (or next) issue first. */
export interface CheckRun {
  draft: Draft
  issues: Issue[]
  currentIssueIndex: number
}
