/** "Delete …?" for the Author's drafts and projects: the same modal as the Researcher's Delete
 * project dialog (scrim, card, Cancel and a red confirm). Esc, the scrim and Cancel close it;
 * a refused delete stays open with the gateway's reason under the text. Its call site sits
 * inside AnimatePresence, or the exit would never play. */

import { motion } from 'framer-motion'
import { type ReactNode, useState } from 'react'

import { Button } from '../../../components/ui'
import { errorMessage } from '../../../lib/author'

const BACKDROP_MOTION = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
const PANEL_MOTION = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.15 },
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = 'Deleting…',
  onCancel,
  onConfirm,
}: {
  title: string
  /** What happens, in a sentence or two. */
  children: ReactNode
  confirmLabel: string
  busyLabel?: string
  onCancel: () => void
  /** Closes the dialog itself when it is done; a throw keeps it open with the reason. */
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancel = () => !busy && onCancel()
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <motion.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={cancel} />
      <motion.div {...PANEL_MOTION} className="relative w-[420px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl">
        <h2 id="confirm-dialog-title" className="font-serif text-lg font-semibold break-words text-ink">
          {title}
        </h2>
        <div className="mt-2 text-sm leading-5 text-ink-muted">{children}</div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-refutes-soft px-3 py-2 text-xs text-refutes">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {/* Focus starts on Cancel, so Enter right after opening does not delete anything. */}
          <Button type="button" variant="ghost" className="border border-border-subtle" disabled={busy} onClick={cancel} autoFocus>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-refutes hover:opacity-90"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
              } catch (e) {
                setError(errorMessage(e))
                setBusy(false)
              }
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
