/**
 * The Papers view's links as a plain list, the counterpart of GraphClaimList: on the canvas a pair
 * is chosen by tapping its edge, which a keyboard or a screen reader cannot do. Choosing a row
 * selects the pair, the same as tapping the edge.
 */

import { cn } from '../../../lib/utils'

export type PairRow = { id: string; label: string; relation: string }

export function GraphPairList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: PairRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <details className="rounded-xl border border-border-subtle bg-surface">
      <summary className="cursor-pointer rounded-xl px-4 py-3 text-[13px] font-medium text-ink pointer-coarse:min-h-11">
        Links as a list · {rows.length}
      </summary>
      <ul className="max-h-80 overflow-y-auto border-t border-border-subtle">
        {rows.map((row) => (
          <li key={row.id} className="border-t border-border-subtle first:border-t-0">
            <button
              type="button"
              aria-pressed={selectedId === row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-accent-soft',
                selectedId === row.id && 'bg-accent-soft',
              )}
            >
              <span className="text-[13px] leading-5 text-ink">{row.label}</span>
              <span className="text-xs text-ink-muted">{row.relation}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
