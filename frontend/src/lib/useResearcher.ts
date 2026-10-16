/** Query hooks for the researcher screens, mirroring useAnalysis. Screens read data only
 * through these. */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { researcherApi } from './researcher'

/** The researcher's actions. Each calls the gateway, then refreshes what it changed. */
export function useResearcherActions() {
  const qc = useQueryClient()
  return {
    /** Create a project and return its id, so the screen can open it. */
    createProject: async (name: string, description: string) => {
      const project = await researcherApi.createProject(name, description)
      await qc.invalidateQueries({ queryKey: ['researcher', 'projects'] })
      return project.id
    },
    addToProject: async (projectId: string, analysisId: string) => {
      await researcherApi.addToProject(projectId, analysisId)
      await qc.invalidateQueries({ queryKey: ['researcher'] })
    },
    renameProject: async (projectId: string, name: string) => {
      await researcherApi.renameProject(projectId, name)
      await qc.invalidateQueries({ queryKey: ['researcher'] })
    },
    /** Delete the project itself; its papers are not touched and fall back to Unsorted. */
    deleteProject: async (projectId: string) => {
      await researcherApi.deleteProject(projectId)
      await qc.invalidateQueries({ queryKey: ['researcher'] })
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

export function useKnowledgeGraph() {
  return useQuery({ queryKey: ['researcher', 'graph'], queryFn: researcherApi.getGraph })
}

export function useResearcherLibrary(projectId: string) {
  return useQuery({
    queryKey: ['researcher', 'library', projectId],
    queryFn: () => researcherApi.getLibrary(projectId),
  })
}
