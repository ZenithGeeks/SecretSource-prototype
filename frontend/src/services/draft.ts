import { mockClaims } from '../mocks/claims'
import { mockDraftInitial, mockDraftReplaced } from '../mocks/drafts'
import type { CheckRun } from '../types'
import { hasVerdict } from '../types'
import { resolveMock, USE_MOCKS } from './_mock'

/**
 * In-memory current state of the one draft the mock backend tracks. Mutated by
 * `replaceCitation` so navigating from the fix panel to "citation replaced" (and back)
 * shows a consistent, decreasing issue count — no server, so the state lives here.
 */
let current: CheckRun = {
  draft: mockDraftInitial,
  issues: mockClaims.filter(hasVerdict),
  currentIssueIndex: 0,
}

const emptyCheckRun: CheckRun = {
  draft: { ...mockDraftInitial, paragraphs: [], citationsFound: 0, issuesRemaining: 0 },
  issues: [],
  currentIssueIndex: 0,
}

export async function getDraftCheck(_id: string): Promise<CheckRun> {
  if (USE_MOCKS) return resolveMock(current, emptyCheckRun)
  // TODO: replace with a real API call once a backend endpoint exists
  throw new Error('Real API not implemented yet')
}

/** Replaces the citation on `claimId` with its suggested source, resolving that issue. */
export async function replaceCitation(claimId: string): Promise<CheckRun> {
  if (USE_MOCKS) {
    const remaining = current.issues.filter((issue) => issue.id !== claimId)
    current = {
      draft: { ...mockDraftReplaced, issuesRemaining: remaining.length },
      issues: remaining,
      currentIssueIndex: 0,
    }
    return resolveMock(current, current)
  }
  // TODO: replace with a real API call once a backend endpoint exists
  throw new Error('Real API not implemented yet')
}
