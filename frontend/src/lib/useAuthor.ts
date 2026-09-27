/**
 * Query hooks for the Author screens, mirroring useResearcher/useAnalysis. Screens read
 * data only through these; every write goes through useAuthorActions, which calls the
 * gateway and invalidates the ['author', …] queries so Check a draft, the editor and the
 * Library all re-render from the same answer.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { followEvents } from './api'
import { authorApi } from './author'
import { parseBib } from './bibtex'
import type { CheckRun, CheckStage, Citation, Draft } from '../types/draftCheck'

export const AUTHOR_KEYS = {
  all: ['author'] as const,
  drafts: ['author', 'drafts'] as const,
  draft: (id: string) => ['author', 'draft', id] as const,
  parse: (id: string) => ['author', 'parse', id] as const,
  checks: (draftId: string) => ['author', 'checks', draftId] as const,
  check: (id: string) => ['author', 'check', id] as const,
  compare: (id: string) => ['author', 'compare', id] as const,
  library: ['author', 'library'] as const,
  projects: ['author', 'projects'] as const,
  project: (id: string) => ['author', 'project', id] as const,
  sources: (projectId?: string) => ['author', 'sources', projectId ?? ''] as const,
}

export function useAuthorDrafts() {
  return useQuery({ queryKey: AUTHOR_KEYS.drafts, queryFn: authorApi.listDrafts })
}

export function useAuthorDraft(draftId: string | null) {
  return useQuery({
    queryKey: AUTHOR_KEYS.draft(draftId ?? ''),
    queryFn: () => authorApi.getDraft(draftId!),
    enabled: Boolean(draftId),
  })
}

export function useAuthorParse(draftId: string | null) {
  return useQuery({
    queryKey: AUTHOR_KEYS.parse(draftId ?? ''),
    queryFn: () => authorApi.parseDraft(draftId!),
    enabled: Boolean(draftId),
  })
}

export function useDraftChecks(draftId: string | null) {
  return useQuery({
    queryKey: AUTHOR_KEYS.checks(draftId ?? ''),
    queryFn: () => authorApi.listChecks(draftId!),
    enabled: Boolean(draftId),
  })
}

/** One check, kept current: fetched, then followed over SSE while it runs. On its last
 * stage everything that shows its outcome (the draft, the history, the Library) refetches. */
export function useAuthorCheck(checkId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: AUTHOR_KEYS.check(checkId ?? ''),
    queryFn: ({ signal }) => authorApi.getCheck(checkId!, signal),
    enabled: Boolean(checkId),
  })
  const running = query.data?.status === 'running'
  const draftId = query.data?.draftId

  useEffect(() => {
    if (!checkId || !running) return
    // The stream replays every stage recorded so far on every connection; skip that many
    // so nothing is appended twice, resyncing on each (re)open (same as useAnalysis).
    let replayed = 0
    const resync = () => {
      replayed = queryClient.getQueryData<CheckRun>(AUTHOR_KEYS.check(checkId))?.stages.length ?? 0
    }
    resync()
    let closed = false
    const close = followEvents<CheckStage>(
      `/author/checks/${encodeURIComponent(checkId)}/events`,
      (stage) => {
        if (replayed > 0) {
          replayed -= 1
        } else {
          queryClient.setQueryData<CheckRun>(AUTHOR_KEYS.check(checkId), (current) =>
            current ? { ...current, stages: [...current.stages, stage] } : current,
          )
        }
        if (stage.stage === 'done' || stage.stage === 'error') {
          void queryClient.invalidateQueries({ queryKey: AUTHOR_KEYS.check(checkId) })
          if (draftId) {
            void queryClient.invalidateQueries({ queryKey: AUTHOR_KEYS.draft(draftId) })
            void queryClient.invalidateQueries({ queryKey: AUTHOR_KEYS.checks(draftId) })
          }
          void queryClient.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
          void queryClient.invalidateQueries({ queryKey: AUTHOR_KEYS.library })
          void queryClient.invalidateQueries({ queryKey: AUTHOR_KEYS.projects })
          if (!closed) {
            closed = true
            close()
          }
        }
      },
      resync,
    )
    return close
  }, [checkId, running, draftId, queryClient])

  return query
}

export function useCompare(checkId: string | null) {
  return useQuery({
    queryKey: AUTHOR_KEYS.compare(checkId ?? ''),
    queryFn: () => authorApi.compareCheck(checkId!),
    enabled: Boolean(checkId),
  })
}

export function useLibrary() {
  return useQuery({ queryKey: AUTHOR_KEYS.library, queryFn: authorApi.getLibrary })
}

export function useAuthorProjects() {
  return useQuery({ queryKey: AUTHOR_KEYS.projects, queryFn: authorApi.listProjects })
}

export function useAuthorProject(projectId: string | null) {
  return useQuery({
    queryKey: AUTHOR_KEYS.project(projectId ?? ''),
    queryFn: () => authorApi.getProject(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useSavedSources(projectId?: string) {
  return useQuery({ queryKey: AUTHOR_KEYS.sources(projectId), queryFn: () => authorApi.listSources(projectId) })
}

/** "Re-check": starts a run and hands back its id; the caller follows it with useAuthorCheck. */
export function useStartCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: authorApi.startCheck,
    onSuccess: (_result, draftId) => {
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.draft(draftId) })
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.checks(draftId) })
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
    },
  })
}

/** The verification report PDF; rejects with the gateway's reason before any check ran. */
export function useExportReport() {
  return useMutation({ mutationFn: authorApi.report })
}

/** The bib keys a draft can cite: its own .bib files plus the project's shared one. */
export function bibKeysOf(draft: Draft): Set<string> {
  return new Set(draft.files.filter((f) => f.kind === 'bib').flatMap((f) => parseBib(f.content).map((e) => e.key)))
}

/** Every write. Each calls the gateway, then invalidates what it changed. */
export function useAuthorActions() {
  const qc = useQueryClient()
  const touched = (draftId: string) => {
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.draft(draftId) })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.parse(draftId) })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.checks(draftId) })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.library })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.projects })
  }
  const libraryChanged = () => {
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.library })
    void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.projects })
    void qc.invalidateQueries({ queryKey: ['author', 'project'] })
    void qc.invalidateQueries({ queryKey: ['author', 'sources'] })
  }

  return {
    createDraft: async (body: Parameters<typeof authorApi.createDraft>[0] = {}): Promise<Draft> => {
      const draft = await authorApi.createDraft(body)
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
      libraryChanged()
      return draft
    },
    uploadDraft: async (file: File, projectId?: string | null): Promise<Draft> => {
      const draft = await authorApi.uploadDraft(file, projectId)
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
      libraryChanged()
      return draft
    },
    updateDraft: async (draftId: string, body: { title?: string; projectId?: string | null }): Promise<Draft> => {
      const draft = await authorApi.updateDraft(draftId, body)
      touched(draftId)
      return draft
    },
    deleteDraft: async (draftId: string): Promise<void> => {
      await authorApi.deleteDraft(draftId)
      void qc.removeQueries({ queryKey: AUTHOR_KEYS.draft(draftId) })
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
      libraryChanged()
    },
    /** Writes one file; `quiet` skips the refetch storm while the editor is typing (the
     * editor keeps its own copy and re-syncs on save). */
    putFile: async (draftId: string, name: string, content: string, quiet = false): Promise<Draft> => {
      const draft = await authorApi.putFile(draftId, name, content)
      if (quiet) {
        qc.setQueryData<Draft>(AUTHOR_KEYS.draft(draftId), (current) =>
          current ? { ...current, files: draft.files, updated: draft.updated } : current,
        )
        void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.parse(draftId) })
      } else {
        touched(draftId)
      }
      return draft
    },
    deleteFile: async (draftId: string, name: string): Promise<Draft> => {
      const draft = await authorApi.deleteFile(draftId, name)
      touched(draftId)
      return draft
    },
    saveDraft: async (draftId: string): Promise<Draft> => {
      const draft = await authorApi.saveDraft(draftId)
      touched(draftId)
      return draft
    },
    attachPdf: async (draftId: string, key: string, file: File): Promise<{ key: string; pdf: string }> => {
      const result = await authorApi.attachPdf(draftId, key, file)
      touched(draftId)
      return result
    },

    overrideCitation: async (draftId: string, checkId: string, citation: Citation, note: string): Promise<CheckRun> => {
      const check = await authorApi.patchCitation(checkId, citation.id, { resolution: { kind: 'overridden', note: note.trim() } })
      qc.setQueryData(AUTHOR_KEYS.check(checkId), check)
      touched(draftId)
      return check
    },
    reopenCitation: async (draftId: string, checkId: string, citation: Citation): Promise<CheckRun> => {
      const check = await authorApi.patchCitation(checkId, citation.id, { resolution: null })
      qc.setQueryData(AUTHOR_KEYS.check(checkId), check)
      touched(draftId)
      return check
    },

    createProject: async (body: { name: string; bib?: string; bibName?: string }) => {
      const project = await authorApi.createProject(body)
      libraryChanged()
      return project
    },
    importProject: async (file: File) => {
      const project = await authorApi.importProject(file)
      libraryChanged()
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
      return project
    },
    updateProject: async (projectId: string, body: { name?: string; bib?: string; bibName?: string }) => {
      const project = await authorApi.updateProject(projectId, body)
      libraryChanged()
      void qc.invalidateQueries({ queryKey: ['author', 'draft'] })
      return project
    },
    deleteProject: async (projectId: string) => {
      await authorApi.deleteProject(projectId)
      libraryChanged()
      void qc.invalidateQueries({ queryKey: AUTHOR_KEYS.drafts })
    },
    removeBibEntry: async (projectId: string, key: string) => {
      const result = await authorApi.removeBibEntry(projectId, key)
      libraryChanged()
      void qc.invalidateQueries({ queryKey: ['author', 'draft'] })
      void qc.invalidateQueries({ queryKey: ['author', 'parse'] })
      return result
    },
    attachProjectPdf: async (projectId: string, key: string, file: File) => {
      const result = await authorApi.attachProjectPdf(projectId, key, file)
      libraryChanged()
      return result
    },

    deleteSource: async (sourceId: string) => {
      await authorApi.deleteSource(sourceId)
      libraryChanged()
    },
    addSourceToBib: async (sourceId: string, projectId: string) => {
      const source = await authorApi.addSourceToBib(sourceId, projectId)
      libraryChanged()
      void qc.invalidateQueries({ queryKey: ['author', 'draft'] })
      return source
    },
    attachSourcePdf: async (sourceId: string, file: File) => {
      const source = await authorApi.attachSourcePdf(sourceId, file)
      libraryChanged()
      return source
    },
  }
}
