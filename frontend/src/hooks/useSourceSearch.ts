import { useCallback, useState } from 'react'

import { searchSources } from '../services'
import { useAsync } from './useAsync'

export function useSourceSearch(initialQuery: string) {
  const [query, setQuery] = useState(initialQuery)
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery)
  const state = useAsync(() => searchSources(submittedQuery), [submittedQuery])

  const search = useCallback((next: string) => setSubmittedQuery(next), [])

  return { query, setQuery, search, state }
}
