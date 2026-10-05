/** The bottom-centre confirmation ("Citation replaced with Santhanam 2022"). Announced via
 * role=status; clears itself after a few seconds or on its close button. */

import { CheckCircle2, X } from 'lucide-react'
import { useEffect } from 'react'

export function Toast({ message, onClose, ms = 5000 }: { message: string | null; onClose: () => void; ms?: number }) {
  useEffect(() => {
    if (!message) return
    const id = window.setTimeout(onClose, ms)
    return () => window.clearTimeout(id)
  }, [message, ms, onClose])

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-7 z-40 flex justify-center px-4">
      {message && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-canvas shadow-lg">
          <CheckCircle2 className="size-4 shrink-0 text-supports" />
          <p className="text-sm">{message}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="flex size-6 items-center justify-center rounded text-canvas/70 hover:bg-canvas/10 hover:text-canvas"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
