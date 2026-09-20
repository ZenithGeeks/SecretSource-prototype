/** Query hooks for the writer screens, mirroring useResearcher. Screens read data only
 * through these, so swapping writerApi's mocks for gateway calls touches nothing else. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { CheckResult } from './writer'
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

export function useSourceSearch(query: string) {
  return useQuery({
    queryKey: ['writer', 'search', query],
    queryFn: () => writerApi.searchSources(query),
  })
}

/** Starts a real (gateway-backed) check of one claim against one citation (SCRUM-236).
 * Returns the new check's id; the caller passes it to `useCheck` to watch it run. */
export function useCheckClaim() {
  return useMutation({
    mutationFn: ({ claim, source }: { claim: string; source: string }) => writerApi.checkClaim(claim, source),
  })
}

/** One check, kept current: fetch it, then follow its stages while it runs. Mirrors
 * useAnalysis — see there for why the stream is followed this way. A check has at most two
 * stages (`resolving`, then `done`/`error`), so unlike a paper analysis's, this does not
 * need to batch rapid-fire refetches. */
export function useCheck(id: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['writer', 'check', id],
    queryFn: () => writerApi.getCheck(id!),
    enabled: Boolean(id),
  })

  const running = query.data?.status === 'running'

  useEffect(() => {
    if (!id || !running) return
    let replayed = 0
    const resync = () => {
      replayed = queryClient.getQueryData<CheckResult>(['writer', 'check', id])?.stages.length ?? 0
    }
    resync()
    let closed = false
    const close = writerApi.onCheckStages(
      id,
      (stage) => {
        const replay = replayed > 0
        if (replay) {
          replayed -= 1
        } else {
          queryClient.setQueryData<CheckResult>(['writer', 'check', id], (current) =>
            current ? { ...current, stages: [...current.stages, stage] } : current,
          )
        }
        if (!replay && (stage.stage === 'done' || stage.stage === 'error')) {
          queryClient.invalidateQueries({ queryKey: ['writer', 'check', id] })
          if (!closed) {
            closed = true
            close()
          }
        }
      },
      resync,
    )
    return () => close()
  }, [id, running, queryClient])

  return query
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
