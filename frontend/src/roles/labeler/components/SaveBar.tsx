/** What is left on this claim, and the buttons that save it. */

import { Check, Loader2 } from 'lucide-react'

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
  className,
}: {
  left: string[]
  dirty: boolean
  saving: boolean
  error: string | null
  savedRows: number | null
  hasNext: boolean
  onSave: (next: boolean) => void
  className?: string
}) {
  let status = 'Nothing changed'
  if (dirty) status = 'Unsaved · Ctrl/⌘+S'
  else if (savedRows != null) status = 'Saved'

  return (
    <div className={cn('sticky bottom-0 z-10 flex flex-col gap-1.5 bg-surface px-3 py-2', className)}>
      {error && (
        <p role="alert" className="rounded-lg bg-refutes-soft px-3 py-1.5 text-sm text-refutes">
          Not saved: {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span aria-live="polite" className="text-xs font-medium text-ink-muted">
          {status}
        </span>
        <span
          title={left.length > 0 ? left.join(' · ') : 'Every decision for this claim is made.'}
          className={cn('text-xs tabular-nums', left.length > 0 ? 'text-ink-muted' : 'flex items-center gap-1 text-supports')}
        >
          {left.length > 0 ? (
            `· ${left.length} left`
          ) : (
            <>
              <Check className="size-3.5" aria-hidden="true" /> Ready
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {hasNext && (
            <Button variant="ghost" onClick={() => onSave(true)} disabled={saving || !dirty}>
              Save and next claim
            </Button>
          )}
          <Button onClick={() => onSave(false)} disabled={saving || !dirty}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save labels
          </Button>
        </div>
      </div>
    </div>
  )
}
