/** One analysis, kept current: fetch it, then follow its stage events while it runs. */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, type Analysis } from './api'

export function useAnalysis(id: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['analysis', id],
    queryFn: () => api.getAnalysis(id!),
    enabled: Boolean(id),
  })

  const running = query.data?.status === 'running'

  useEffect(() => {
    if (!id || !running) return
    return api.onStages(id, (stage) => {
      // Stages stream in; claims and verdicts come from a refetch when the run ends.
      queryClient.setQueryData<Analysis>(['analysis', id], (current) =>
        current ? { ...current, stages: [...current.stages, stage] } : current,
      )
      if (stage.stage === 'done' || stage.stage === 'error') {
        queryClient.invalidateQueries({ queryKey: ['analysis', id] })
        queryClient.invalidateQueries({ queryKey: ['analyses'] })
      }
    })
  }, [id, running, queryClient])

  return query
}

export function useAnalyses() {
  return useQuery({ queryKey: ['analyses'], queryFn: api.listAnalyses })
}
