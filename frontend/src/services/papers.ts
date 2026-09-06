import { mockPapers } from '../mocks/papers'
import type { Paper } from '../types'
import { resolveMock, USE_MOCKS } from './_mock'

export async function getRecentPapers(): Promise<Paper[]> {
  if (USE_MOCKS) return resolveMock(mockPapers.slice(0, 3), [])
  // TODO: replace with a real API call once a backend endpoint exists
  throw new Error('Real API not implemented yet')
}
