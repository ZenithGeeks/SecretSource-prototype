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
    // The stream replays every stage recorded so far on every connection it opens,
    // including a reconnect after a dropped one, then sends new ones. Skip that many so
    // nothing is appended twice; resync the count on each open, not just the first, since
    // a reconnect replays from the start again (#133).
    let replayed = 0
    const resync = () => {
      replayed = queryClient.getQueryData<Analysis>(['analysis', id])?.stages.length ?? 0
    }
    resync()
    let closed = false
    const close = api.onStages(
      id,
      (stage) => {
        if (replayed > 0) {
          replayed -= 1
        } else {
          // Stages stream in; claims and verdicts come from a refetch when the run ends.
          queryClient.setQueryData<Analysis>(['analysis', id], (current) =>
            current ? { ...current, stages: [...current.stages, stage] } : current,
          )
        }
        // A run that ended between the fetch and the stream replays its end too; act on
        // it, and close for good — nothing more is coming, so there is nothing left to
        // reconnect for.
        if (stage.stage === 'done' || stage.stage === 'error') {
          queryClient.invalidateQueries({ queryKey: ['analysis', id] })
          queryClient.invalidateQueries({ queryKey: ['analyses'] })
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

export function useAnalyses() {
  return useQuery({ queryKey: ['analyses'], queryFn: api.listAnalyses })
}
