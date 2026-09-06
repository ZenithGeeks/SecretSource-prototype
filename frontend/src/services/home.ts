import { mockClaims } from '../mocks/claims'
import { mockDraftInitial } from '../mocks/drafts'
import { mockPapers } from '../mocks/papers'
import { mockUser } from '../mocks/user'
import type { HomeSummary } from '../types'
import { resolveMock, USE_MOCKS } from './_mock'

const mockHomeSummary: HomeSummary = {
  greetingName: mockUser.name,
  draftFileName: mockDraftInitial.fileName,
  draftLastCheckedLabel: mockDraftInitial.lastCheckedLabel,
  attentionClaims: mockClaims.slice(0, 3), // one refutes, one insufficient, one supports
  recentPapers: mockPapers.slice(0, 3),
}

const emptyHomeSummary: HomeSummary = {
  ...mockHomeSummary,
  attentionClaims: [],
  recentPapers: [],
}

export async function getHomeSummary(): Promise<HomeSummary> {
  if (USE_MOCKS) return resolveMock(mockHomeSummary, emptyHomeSummary)
  // TODO: replace with a real API call once a backend endpoint exists
  throw new Error('Real API not implemented yet')
}
