/** Query hooks for the researcher screens, mirroring useAnalysis. Screens read data only
 * through these, so swapping researcherApi's mocks for gateway calls touches nothing else. */

import { useQuery } from '@tanstack/react-query'

import { researcherApi } from './researcher'

export function useResearcherHome() {
  return useQuery({ queryKey: ['researcher', 'home'], queryFn: researcherApi.getHome })
}

export function useFieldConsensus(question: string) {
  return useQuery({
    queryKey: ['researcher', 'consensus', question],
    queryFn: () => researcherApi.askConsensus(question),
  })
}

export function useResearcherLibrary() {
  return useQuery({ queryKey: ['researcher', 'library'], queryFn: researcherApi.getLibrary })
}
