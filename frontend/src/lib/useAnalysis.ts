/** One analysis, kept current: fetch it, then follow its stage events while it runs.
 * A re-check after the owner uploads a cited PDF has no event stream (#986), so while that
 * re-check is still going the analysis is refetched until its last stage for that ref is
 * `rechecked` or `recheck-failed`. */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { api, type Analysis } from './api'
import { analysisLabel } from './claims'
import { showDoneNotice } from './desktopNotice'
import { refsRechecking } from './sourceUpload'

/** Checks that report within this long of each other share one refetch of the analysis. */
const REFETCH_WINDOW_MS = 300

/** How often to ask again while an uploaded PDF is still being checked. */
const RECHECK_POLL_MS = 1000

export function useAnalysis(id: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['analysis', id],
    // The signal aborts a refetch that a newer one replaced, so it does not reach the gateway.
    queryFn: ({ signal }) => api.getAnalysis(id!, signal),
    enabled: Boolean(id),
  })

  const status = query.data?.status
  const running = status === 'running'
  const pendingRechecks = refsRechecking(query.data?.stages ?? []).join('\0')

  // The re-check records its stages on the analysis and publishes nothing. Keep asking until
  // every ref that started has a later `rechecked` or `recheck-failed` stage. The key is the set of refs still
  // going, so a refetch that is still `rechecking` does not restart the poll.
  useEffect(() => {
    if (!id || status !== 'done' || !pendingRechecks) return
    let stopped = false
    const pull = () => {
      void api.getAnalysis(id).then(
        (next) => {
          if (!stopped) queryClient.setQueryData(['analysis', id], next)
        },
        () => {
          // A missed poll leaves the analysis on screen. The next tick tries again.
        },
      )
    }
    pull()
    const timer = window.setInterval(pull, RECHECK_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [id, status, pendingRechecks, queryClient])

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
    // At most one refetch per window. invalidateQueries cancels a refetch in flight and starts
    // another, so calling it once per stage sent a request per stage: opening a run with 23
    // finished checks sent about 30 identical requests in a third of a second (#165).
    let pending: number | undefined
    const refetchSoon = () => {
      if (pending !== undefined) return
      pending = window.setTimeout(() => {
        pending = undefined
        queryClient.invalidateQueries({ queryKey: ['analysis', id] })
      }, REFETCH_WINDOW_MS)
    }
    let closed = false
    const close = api.onStages(
      id,
      (stage) => {
        const replay = replayed > 0
        if (replay) {
          replayed -= 1
        } else {
          // Stages stream in; claims and verdicts come from a refetch when the run ends.
          queryClient.setQueryData<Analysis>(['analysis', id], (current) =>
            current ? { ...current, stages: [...current.stages, stage] } : current,
          )
        }
        // The stages that changed the analysis itself: the claims exist server-side from
        // `extracted` on, and each verdict is folded onto its claim before its stage is
        // published, so refetch and the reader gets them while the run is still going
        // rather than all at once at the end. A replayed stage needs none: the analysis
        // fetched before the stream opened already has what it changed.
        if (
          !replay &&
          (stage.stage === 'extracted' ||
            stage.stage === 'verified' ||
            stage.stage === 'failed' ||
            stage.stage === 'figures')
        ) {
          refetchSoon()
        }
        // A run that ended between the fetch and the stream replays its end too; act on
        // it, and close for good — nothing more is coming, so there is nothing left to
        // reconnect for.
        if (stage.stage === 'done' || stage.stage === 'error') {
          window.clearTimeout(pending)
          pending = undefined
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
    return () => {
      window.clearTimeout(pending)
      close()
    }
  }, [id, running, queryClient])

  return query
}

export function useAnalyses() {
  return useQuery({
    queryKey: ['analyses'],
    queryFn: api.listAnalyses,
    // Nothing keeps this current once a running analysis's own detail view is closed
    // (its stream, and the invalidation it does on done/error, both go with it). Poll
    // while anything is running so the sidebar doesn't need a page reload to catch up.
    refetchInterval: (query) =>
      query.state.data?.some((analysis) => analysis.status === 'running') ? 3000 : false,
    // Keep asking in a hidden tab too, so useAnalysisNotices can tell the reader a run ended.
    refetchIntervalInBackground: true,
  })
}

/** A browser notice when an analysis this tab saw running is done or stopped. Only runs seen
 * running are announced, so a reload does not repeat old news.
 *
 * Args:
 *   analyses: The list from useAnalyses.
 *   onOpen: Opens the analysis when its notice is clicked.
 */
export function useAnalysisNotices(analyses: Analysis[] | undefined, onOpen: (id: string) => void) {
  const running = useRef<Set<string> | null>(null) // null until the first list
  const open = useRef(onOpen)
  useEffect(() => {
    open.current = onOpen
  })

  useEffect(() => {
    if (!analyses) return
    for (const analysis of analyses) {
      if (!running.current?.has(analysis.id) || analysis.status === 'running') continue
      const title = analysis.status === 'done' ? 'Analysis finished' : 'Analysis stopped'
      showDoneNotice(title, analysisLabel(analysis), analysis.id, () => open.current(analysis.id))
    }
    running.current = new Set(analyses.filter((a) => a.status === 'running').map((a) => a.id))
  }, [analyses])
}
