/** Query hooks for the writer screens, mirroring useResearcher. Screens read data only
 * through these, so swapping writerApi's mocks for gateway calls touches nothing else. */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { store } from './writerStore'
import { writerApi } from './writer'
import type { VerdictKind } from './writer'

export function useWriterHome() {
  return useQuery({ queryKey: ['writer', 'home'], queryFn: writerApi.getHome })
}

export function useDrafts() {
  return useQuery({ queryKey: ['writer', 'drafts'], queryFn: writerApi.getDrafts })
}

export function useDraft(draftId: string) {
  return useQuery({ queryKey: ['writer', 'draft', draftId], queryFn: () => writerApi.getDraft(draftId) })
}

export function useDraftCheck(draftId?: string, filterKinds?: VerdictKind[]) {
  return useQuery({
    queryKey: ['writer', 'draft-check', draftId, filterKinds?.join(',')],
    queryFn: () => writerApi.getDraftCheck(draftId, filterKinds),
  })
}

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
    replaceCitation: (claimId: string, sourceId: string): void => {
      store.replaceCitation(claimId, sourceId)
      qc.invalidateQueries({ queryKey: ['writer', 'draft-check'] })
      qc.invalidateQueries({ queryKey: ['writer', 'home'] })
    },
    undoReplacement: (claimId: string): void => {
      store.undoReplacement(claimId)
      qc.invalidateQueries({ queryKey: ['writer', 'draft-check'] })
    },
    dismissReplacement: (claimId: string): void => {
      store.dismissReplacement(claimId)
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
