/**
 * The graph's claims as a plain list, for a reader who cannot use the canvas (keyboard, screen
 * reader) or who wants the contradicted claims first. Choosing a row selects the claim, the same
 * as tapping its dot, so the detail panel opens beside the graph.
 */

import type { KeyboardEvent } from 'react'

import type { Standing } from '../../../lib/claims'
import { VerdictBadge } from '../../../components/ui'
import { cn } from '../../../lib/utils'

export type ClaimRow = { id: string; label: string; standing: Standing }

/** Contradicted claims first, then silent, backed and not yet checked. */
const ORDER: Standing[] = ['refutes', 'insufficient', 'supports', 'unchecked']

export function GraphClaimList({
  rows,
  total,
  selectedId,
  onSelect,
}: {
  /** The claims to list: all of them, or only those the filter and the pressed finding keep. */
  rows: ClaimRow[]
  /** How many claims the graph has, so the heading can say "2 of 9" while a filter is on. */
  total: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  // Up and Down step from one claim to the next without going back to Tab.
  const step = (event: KeyboardEvent<HTMLUListElement>) => {
    const change = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (!change) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button')]
    const at = buttons.indexOf(document.activeElement as HTMLElement)
    buttons[Math.min(Math.max(at + change, 0), buttons.length - 1)]?.focus()
  }
  const ordered = [...rows].sort((a, b) => ORDER.indexOf(a.standing) - ORDER.indexOf(b.standing))
  return (
    <details className="rounded-xl border border-border-subtle bg-surface">
      <summary className="cursor-pointer rounded-xl px-4 py-3 text-[13px] font-medium text-ink pointer-coarse:min-h-11">
        Claims as a list · {rows.length === total ? total : `${rows.length} of ${total}`}
      </summary>
      {rows.length === 0 && (
        <p className="border-t border-border-subtle px-4 py-3 text-[13px] text-ink-muted">No claim matches the filter.</p>
      )}
      <ul onKeyDown={step} className="max-h-80 overflow-y-auto border-t border-border-subtle">
        {ordered.map((row) => (
          <li key={row.id} className="border-t border-border-subtle first:border-t-0">
            <button
              type="button"
              aria-pressed={selectedId === row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                'flex w-full flex-col items-start gap-1.5 px-4 py-2.5 text-left hover:bg-accent-soft',
                selectedId === row.id && 'bg-accent-soft',
              )}
            >
              <span className="line-clamp-2 text-[13px] leading-5 text-ink">{row.label}</span>
              <VerdictBadge verdict={row.standing} />
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
