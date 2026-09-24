/**
 * Query hooks for the Author screens, mirroring useWriter/useResearcher. Screens read data
 * only through these; every write goes through useAuthorActions, which mutates the store and
 * invalidates the ['author', …] queries so Draft check and the editor both re-render.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authorApi } from './author'
import { authorStore } from './authorStore'
import type { SearchResult } from '../types/draftCheck'

export const AUTHOR_KEYS = {
  all: ['author'] as const,
  drafts: ['author', 'drafts'] as const,
  draft: (id: string) => ['author', 'draft', id] as const,
  check: (id: string) => ['author', 'check', id] as const,
  parse: (id: string) => ['author', 'parse', id] as const,
  search: (query: string) => ['author', 'search', query] as const,
}

export function useAuthorDrafts() {
  return useQuery({ queryKey: AUTHOR_KEYS.drafts, queryFn: authorApi.getDrafts })
}

export function useAuthorDraft(draftId: string) {
  return useQuery({ queryKey: AUTHOR_KEYS.draft(draftId), queryFn: () => authorApi.getDraft(draftId) })
}

export function useAuthorCheck(draftId: string) {
  return useQuery({ queryKey: AUTHOR_KEYS.check(draftId), queryFn: () => authorApi.getCheck(draftId) })
}

export function useAuthorParse(draftId: string) {
  return useQuery({ queryKey: AUTHOR_KEYS.parse(draftId), queryFn: () => authorApi.parseDraft(draftId) })
}

/** An empty query lists the suggested fixes for the draft's open issues (Figma shows results
 * before anything is typed), so the card is never blank. */
export function useAuthorSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({ queryKey: AUTHOR_KEYS.search(trimmed), queryFn: () => authorApi.search(trimmed) })
}

/** "Re-check" — the one action with real latency, so it is a mutation with isPending. */
export function useRecheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: authorApi.recheck,
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTHOR_KEYS.all }),
  })
}

/** The verification report PDF; rejects with ReportUnavailable until the gateway has it. */
export function useExportReport() {
  return useMutation({ mutationFn: authorApi.exportReport })
}

/** Session-local writes. Each mutates the store, then invalidates what it changed. */
export function useAuthorActions() {
  const qc = useQueryClient()
  const touched = (draftId: string) => {
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.draft(draftId) })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.check(draftId) })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.parse(draftId) })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
  }
  return {
    createDraft: (title?: string): string => {
      const draft = authorStore.createDraft(title)
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
      return draft.id
    },
    updateFile: (draftId: string, name: string, content: string): void => {
      authorStore.updateFile(draftId, name, content)
      touched(draftId)
    },
    addFile: (draftId: string, name: string): void => {
      authorStore.addFile(draftId, name)
      touched(draftId)
    },
    saveDraft: (draftId: string): void => {
      authorStore.saveDraft(draftId)
      touched(draftId)
    },
    /** Returns the next open issue's id, so the caller can move the pager along. */
    replaceCitation: (citationId: string, replacement: SearchResult): string | undefined => {
      const citation = authorStore.replaceCitation(citationId, replacement)
      touched(citation.draftId)
      return authorStore.nextOpenIssue(citation.draftId, citationId)?.id
    },
    overrideCitation: (citationId: string, note: string): string | undefined => {
      const citation = authorStore.overrideCitation(citationId, note)
      touched(citation.draftId)
      return authorStore.nextOpenIssue(citation.draftId, citationId)?.id
    },
    reopenCitation: (citationId: string): void => {
      const citation = authorStore.reopenCitation(citationId)
      touched(citation.draftId)
    },
    attachSourcePdf: (citationId: string, fileName: string): void => {
      const citation = authorStore.attachSourcePdf(citationId, fileName)
      touched(citation.draftId)
    },
    deleteAll: (): void => {
      authorStore.deleteAll()
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.all })
    },
  }
}
