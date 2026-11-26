/**
 * The verdict stamp of the Ask panel (Backed, Contradicted, Silent, Not checked,
 * Checking…), shared so other redesign screens say a statement's verdict the same way (#713).
 * Words and colours come from src/lib/stamps.ts.
 */

import { Loader2 } from 'lucide-react'

import { STAMPS, type StampVerdict } from '../lib/stamps'
import { cn } from '../lib/utils'

/** One stamp as a pill: a dot (a spinner while checking) and the verdict's word. */
export function Stamp({ verdict }: { verdict: StampVerdict }) {
  const stamp = STAMPS[verdict]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', stamp.pill)}>
      {verdict === 'checking' ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {stamp.label}
    </span>
  )
}
