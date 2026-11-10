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
  if (dirty) status = 'Unsaved changes · Ctrl/⌘+S saves'
  else if (savedRows != null) status = `Saved ${savedRows} row${savedRows === 1 ? '' : 's'}`

  return (
    <div className={cn('sticky bottom-0 z-10 flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3', className)}>
      {left.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          {left.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-supports">
          <Check className="size-4" /> Every decision for this claim is made.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-refutes-soft px-3 py-2 text-sm text-refutes">
          Not saved: {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onSave(false)} disabled={saving || !dirty}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save labels
        </Button>
        {hasNext && (
          <Button variant="ghost" onClick={() => onSave(true)} disabled={saving || !dirty}>
            Save and next claim
          </Button>
        )}
        <span aria-live="polite" className="text-xs text-ink-muted">
          {status}
        </span>
      </div>
    </div>
  )
}
