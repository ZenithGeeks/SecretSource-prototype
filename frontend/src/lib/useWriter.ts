/** Query hooks for the writer screens, mirroring useResearcher. Screens read data only
 * through these, so swapping writerApi's mocks for gateway calls touches nothing else. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { writerApi } from './writer'

export function useWriterHome() {
  return useQuery({ queryKey: ['writer', 'home'], queryFn: writerApi.getHome })
}

export function useDraftCheck() {
  return useQuery({ queryKey: ['writer', 'draft-check'], queryFn: writerApi.getDraftCheck })
}

/** Replaces a claim's citation with its suggested source, resolving that issue. */
export function useReplaceCitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: writerApi.replaceCitation,
    onSuccess: (checkRun) => {
      queryClient.setQueryData(['writer', 'draft-check'], checkRun)
    },
  })
}

export function useSourceSearch(query: string) {
  return useQuery({
    queryKey: ['writer', 'search', query],
    queryFn: () => writerApi.searchSources(query),
  })
}
