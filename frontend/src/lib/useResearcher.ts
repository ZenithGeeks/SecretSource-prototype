/** Query hooks for the researcher screens, mirroring useAnalysis. Screens read data only
 * through these, so swapping researcherApi's mocks for gateway calls touches nothing else. */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { LibraryPaper } from './researcher'
import { researcherApi } from './researcher'
import { store } from './researcherStore'

/** Session-local mutations. Each mutates the store and invalidates the affected queries so
 * the screens re-render with the new data. Swap the store calls for gateway POSTs later. */
export function useResearcherActions() {
  const qc = useQueryClient()
  return {
    createProject: (name: string): string => {
      const id = store.createProject(name)
      qc.invalidateQueries({ queryKey: ['researcher', 'projects'] })
      return id
    },
    addPaper: (projectId: string, paper: LibraryPaper): void => {
      store.addPaper(projectId, paper)
      qc.invalidateQueries({ queryKey: ['researcher'] })
    },
    fileQueuePaper: (title: string): void => {
      store.fileQueuePaper(title)
      qc.invalidateQueries({ queryKey: ['researcher', 'home'] })
    },
    deleteProject: (projectId: string): void => {
      store.deleteProject(projectId)
      qc.invalidateQueries({ queryKey: ['researcher', 'projects'] })
    },
  }
}

export function useResearcherHome() {
  return useQuery({ queryKey: ['researcher', 'home'], queryFn: researcherApi.getHome })
}

export function useFieldConsensus(question: string) {
  return useQuery({
    queryKey: ['researcher', 'consensus', question],
    queryFn: () => researcherApi.askConsensus(question),
  })
}

export function useProjects() {
  return useQuery({ queryKey: ['researcher', 'projects'], queryFn: researcherApi.getProjects })
}

// Global (all projects/roles), like the analyses History lists — keyed outside the researcher namespace.
export function useKnowledgeGraph() {
  return useQuery({ queryKey: ['graph'], queryFn: researcherApi.getGraph })
}

export function useResearcherLibrary(projectId: string) {
  return useQuery({
    queryKey: ['researcher', 'library', projectId],
    queryFn: () => researcherApi.getLibrary(projectId),
  })
}

export function useResearcherPaper(projectId: string, paperId: string) {
  return useQuery({
    queryKey: ['researcher', 'paper', projectId, paperId],
    queryFn: () => researcherApi.getPaper(projectId, paperId),
  })
}
