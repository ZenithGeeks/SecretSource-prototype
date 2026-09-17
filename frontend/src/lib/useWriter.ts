/** Query hooks for the writer screens, mirroring useResearcher. Screens read data only
 * through these, so swapping writerApi's mocks for gateway calls touches nothing else. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { store } from './writerStore'
import { writerApi } from './writer'

export function useWriterHome() {
  return useQuery({ queryKey: ['writer', 'home'], queryFn: writerApi.getHome })
}

export function useDrafts() {
  return useQuery({ queryKey: ['writer', 'drafts'], queryFn: writerApi.getDrafts })
}

export function useDraft(draftId: string) {
  return useQuery({ queryKey: ['writer', 'draft', draftId], queryFn: () => writerApi.getDraft(draftId) })
}

export function useDraftCheck(draftId?: string) {
  return useQuery({
    queryKey: ['writer', 'draft-check', draftId],
    queryFn: () => writerApi.getDraftCheck(draftId),
  })
}

/** Replaces a claim's citation with its suggested source, resolving that issue. Existing
 * behaviour, kept for DraftCheck's "Replace citation" button — see writerApi.replaceCitation. */
export function useReplaceCitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: writerApi.replaceCitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['writer'] })
    },
  })
}

/** Text-searches sources; the "search in" scope is applied client-side by the caller over this
 * one cached result set (see matchesSearchScope) rather than being part of the query key —
 * scope is a handful of booleans over three-ish mock rows, not worth a fetch per combination. */
export function useSourceSearch(query: string) {
  return useQuery({
    queryKey: ['writer', 'search', query],
    queryFn: () => writerApi.searchSources(query),
  })
}

/** Session-local mutations. Each mutates the store and invalidates the affected queries so
 * the screens re-render with the new data. Swap the store calls for gateway POSTs later. */
export function useWriterActions() {
  const qc = useQueryClient()
  return {
    createDraft: (title?: string): string => {
      const id = store.createDraft(title)
      qc.invalidateQueries({ queryKey: ['writer', 'drafts'] })
      qc.invalidateQueries({ queryKey: ['writer', 'home'] })
      return id
    },
    saveDraftSource: (draftId: string, latexSource: string): void => {
      store.saveDraftSource(draftId, latexSource)
      qc.invalidateQueries({ queryKey: ['writer', 'draft', draftId] })
      qc.invalidateQueries({ queryKey: ['writer', 'draft-check'] })
    },
    /** Returns whether the replacement applied, so the caller can branch on a stale claim id. */
    replaceCitation: (claimId: string, sourceId: string): boolean => {
      const applied = store.replaceCitation(claimId, sourceId)
      if (applied) {
        qc.invalidateQueries({ queryKey: ['writer', 'draft-check'] })
        qc.invalidateQueries({ queryKey: ['writer', 'home'] })
        qc.invalidateQueries({ queryKey: ['writer', 'search'] })
      }
      return applied
    },
    undoReplacement: (claimId: string): void => {
      store.undoReplacement(claimId)
      qc.invalidateQueries({ queryKey: ['writer', 'draft-check'] })
    },
    recheckClaim: (claimId: string): void => {
      store.recheckClaim(claimId)
      qc.invalidateQueries({ queryKey: ['writer', 'draft-check'] })
      qc.invalidateQueries({ queryKey: ['writer', 'home'] })
    },
    markInLibrary: (sourceId: string): void => {
      store.markInLibrary(sourceId)
      qc.invalidateQueries({ queryKey: ['writer', 'search'] })
    },
    deleteAll: (): void => {
      store.deleteAll()
      qc.invalidateQueries({ queryKey: ['writer'] })
    },
  }
}
