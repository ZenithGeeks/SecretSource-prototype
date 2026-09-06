import { useCallback, useState } from 'react'

import { getDraftCheck, replaceCitation } from '../services'
import type { CheckRun } from '../types'
import { useAsync } from './useAsync'

export function useDraftCheck(id: string) {
  const [reloadToken, setReloadToken] = useState(0)
  const state = useAsync(() => getDraftCheck(id), [id, reloadToken])

  // Replace optimistically: swap the current issue out locally, then reconcile with the
  // service response once it resolves.
  const [optimistic, setOptimistic] = useState<CheckRun | null>(null)

  const replace = useCallback(
    async (claimId: string) => {
      if (state.status !== 'loaded') return
      setOptimistic({
        ...state.data,
        issues: state.data.issues.filter((issue) => issue.id !== claimId),
      })
      try {
        await replaceCitation(claimId)
      } finally {
        setOptimistic(null)
        setReloadToken((n) => n + 1)
      }
    },
    [state],
  )

  if (optimistic && state.status === 'loaded') {
    return { state: { status: 'loaded', data: optimistic } as const, replace }
  }
  return { state, replace }
}
