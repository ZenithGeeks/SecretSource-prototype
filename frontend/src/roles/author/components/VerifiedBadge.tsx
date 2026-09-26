/**
 * Does this source actually say it? The badge on a search result: the verification's verdict
 * once it ran, a spinner while it runs, an error with a retry when the gateway could not read
 * the paper, and "Check" before it started (the top results start on their own, the rest on
 * request). The verification itself is useVerification: one call per claim and source,
 * cached on the gateway.
 */

import { Loader2, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'

import { useVerification } from '../../../lib/useAuthor'
import { errorMessage } from '../../../lib/author'
import type { Verification } from '../../../types/draftCheck'
import { CitationBadge } from './Verdicts'

export function VerifiedBadge({
  claim,
  identifier,
  auto,
  onVerified,
}: {
  claim: string
  identifier: string
  /** Start without being asked (the top results of a search). */
  auto: boolean
  onVerified?: (verification: Verification) => void
}) {
  const verification = useVerification(claim, identifier, auto)
  const data = verification.data
  // The parent learns the verdict after the commit, not during this render (React forbids
  // setting a parent's state while a child renders).
  useEffect(() => {
    if (data) onVerified?.(data)
  }, [data, onVerified])
  if (data) {
    if (data.verdict === 'unavailable') {
      return (
        <span className="flex items-center gap-1.5 text-xs text-ink-muted" title={data.message}>
          <CitationBadge verdict="unavailable" />
          could not read the paper
          <button type="button" onClick={() => void verification.refetch()} className="rounded text-accent hover:underline">
            retry
          </button>
        </span>
      )
    }
    return <CitationBadge verdict={data.verdict} />
  }
  if (verification.isFetching) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-muted" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        checking…
      </span>
    )
  }
  if (verification.isError) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-refutes">
        check failed: {errorMessage(verification.error)}
        <button type="button" onClick={() => void verification.refetch()} className="rounded text-accent hover:underline">
          <RefreshCw className="inline size-3" aria-hidden="true" /> retry
        </button>
      </span>
    )
  }
  if (!claim.trim()) return null
  return (
    <button
      type="button"
      onClick={() => void verification.refetch()}
      className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft"
    >
      Check against the claim
    </button>
  )
}
