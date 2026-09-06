import { mockSearchResponse } from '../mocks/searchResults'
import type { SearchResponse } from '../types'
import { resolveMock, USE_MOCKS } from './_mock'

const emptyResponse: SearchResponse = { ...mockSearchResponse, results: [] }

export async function searchSources(_query: string): Promise<SearchResponse> {
  if (USE_MOCKS) return resolveMock(mockSearchResponse, emptyResponse)
  // TODO: replace with a real API call once a backend endpoint exists
  throw new Error('Real API not implemented yet')
}
