/** Which features the gateway can serve right now, from GET /health. The hosted app depends on
 * the PC for the worker and ColBERT, so when the PC is off, starting an analysis or asking would
 * only fail later; the controls turn off instead and say why (#763). */

import { useQuery } from '@tanstack/react-query'

import { request } from './api'

export type Feature = 'analyses' | 'ask'

export const OFFLINE_REASON: Record<Feature, string> = {
  analyses: 'The checking server is offline, so new analyses cannot start. Try again later.',
  ask: 'The library search is offline, so Ask cannot answer. Try again later.',
}

// The gateway checks its dependencies at most every 30 s, so asking more often shows nothing new.
const POLL_MS = 30_000

/** Whether `feature` works now. Every component shares one /health query. */
export function useFeature(feature: Feature): boolean {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => request<{ features?: Partial<Record<Feature, boolean>> }>('/health'),
    refetchInterval: POLL_MS,
    retry: false,
  })
  // Before /health answers, after it fails, or on a gateway too old to send `features`, the
  // feature counts as on: a slow or missing health check should not block anyone.
  return health.data?.features?.[feature] ?? true
}
