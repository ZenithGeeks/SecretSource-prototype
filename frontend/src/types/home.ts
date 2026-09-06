import type { Claim } from './claim'
import type { Paper } from './paper'

/** Everything the writer home screen shows about the user's most active draft. */
export interface HomeSummary {
  greetingName: string
  draftFileName: string
  draftLastCheckedLabel: string
  attentionClaims: Claim[]
  recentPapers: Paper[]
}
