/** What is left on this claim, and the buttons that save it, or every claim with unsaved changes. */

import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '../../../components/ui'
import { cn } from '../../../lib/utils'

export function SaveBar({
  left,
  dirty,
  saving,
  error,
  savedRows,
  hasNext,
  onSave,
  onStep,
  claimNumber,
  unsavedCount = 0,
  onSaveAll,
  blocked = null,
  warn = false,
  className,
}: {
  left: string[]
  dirty: boolean
  /** Why the claim cannot be saved as it stands, when it cannot: the save buttons stay off. */
  blocked?: string | null
  /** The labeler tried to save while blocked, so the reason shows as a warning, not a hint. */
  warn?: boolean
  saving: boolean
  error: string | null
  savedRows: number | null
  hasNext: boolean
  onSave: (next: boolean) => void
  /** Goes to where `left[index]` is done: the decision, a passage or a level form. */
  onStep: (index: number) => void
  /** The claim's number in the paper, so the buttons say which claim they save. */
  claimNumber: number
  /** Claims with unsaved changes in the whole paper; from two up, Save all is offered. */
  unsavedCount?: number
  onSaveAll?: () => void
  className?: string
}) {
  // Saving a claim with work left is allowed; the status says before and after that it is a partial save.
  let status = 'Nothing changed'
  if (blocked) status = blocked
  else if (dirty) status = left.length > 0 ? 'Unsaved · saves as not finished, still to do:' : 'Unsaved · Ctrl/⌘+S'
  else if (savedRows != null) status = left.length > 0 ? 'Saved, not finished · still to do:' : 'Saved'
  const off = saving || !dirty || Boolean(blocked)
  const [showAll, setShowAll] = useState(false)
  const rest = useId()
  const more = !blocked && left.length > 1
  const step = 'text-left text-ink-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <div className={cn('sticky bottom-0 z-10 flex flex-col gap-1.5 bg-surface px-3 py-2', className)}>
      {error && (
        <p role="alert" className="rounded-lg bg-refutes-soft px-3 py-1.5 text-sm text-refutes">
          Not saved: {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* One line: the first thing left is cut short, so "and 2 more" stays beside it. */}
        <div className="flex w-full min-w-0 items-center gap-2">
          <span aria-live="polite" className={cn('shrink-0 text-xs font-medium', blocked && warn ? 'text-refutes' : 'text-ink-muted')}>
            {status}
          </span>
          {/* Blocked, the status already names the one thing to do. Expanded, the list below has every item. */}
          {/* Each thing left is a button to where it is done: the level form may be scrolled out of view. */}
          {!blocked && !(more && showAll) && left.length > 0 && (
            <button type="button" title={left.join(' · ')} onClick={() => onStep(0)} className={cn(step, 'min-w-0 truncate text-xs tabular-nums')}>
              {left[0]}
            </button>
          )}
          {!blocked && left.length === 0 && (
            <span title="Every decision for this claim is made." className="flex min-w-0 items-center gap-1 text-xs text-supports">
              {/* Not "finished" while unsaved: the progress count only counts saved claims. */}
              <Check className="size-3.5" aria-hidden="true" /> {dirty ? 'Every decision made, not saved yet' : 'Every decision made'}
            </span>
          )}
          {more && (
            <button
              type="button"
              aria-expanded={showAll}
              aria-controls={rest}
              onClick={() => setShowAll(!showAll)}
              className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs text-ink-muted hover:text-ink"
            >
              <ChevronDown className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', !showAll && '-rotate-90')} aria-hidden="true" />
              {showAll ? 'Show less' : `and ${left.length - 1} more`}
            </button>
          )}
        </div>
        {/* Under the status line at full width, so a long item wraps instead of pushing the row wider. */}
        {more && showAll && (
          <ul id={rest} className="w-full list-inside list-disc text-xs wrap-anywhere text-ink-muted">
            {left.map((item, index) => (
              <li key={item}>
                <button type="button" onClick={() => onStep(index)} className={step}>
                  {item}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {unsavedCount > 1 && onSaveAll && (
            <Button variant="ghost" onClick={onSaveAll} disabled={saving} aria-keyshortcuts="Control+Shift+S Meta+Shift+S">
              Save all unsaved ({unsavedCount})
            </Button>
          )}
          {/* Filled only when the claim is complete: with work left it saves as not finished, so it
              is not the step the page points to. */}
          {hasNext && (
            <Button variant={left.length > 0 ? 'ghost' : 'solid'} onClick={() => onSave(true)} disabled={off} title={blocked ?? undefined}>
              Save claim {claimNumber} and next
            </Button>
          )}
          <Button
            variant={hasNext || left.length > 0 ? 'ghost' : 'solid'}
            onClick={() => onSave(false)}
            disabled={off}
            title={blocked ?? undefined}
            aria-keyshortcuts="Control+S Meta+S"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save claim {claimNumber}
          </Button>
        </div>
      </div>
    </div>
  )
}
