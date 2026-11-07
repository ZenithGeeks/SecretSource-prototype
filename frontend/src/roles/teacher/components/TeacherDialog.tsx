import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

export function TeacherDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) {
      openerRef.current?.focus()
      openerRef.current = null
      return
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-dialog-title"
        aria-describedby={description ? 'teacher-dialog-description' : undefined}
        className="w-full max-w-lg rounded-2xl border border-border-subtle bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="teacher-dialog-title" className="font-serif text-2xl font-semibold text-ink">{title}</h2>
            {description && <p id="teacher-dialog-description" className="mt-2 text-sm leading-6 text-ink-muted">{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg px-2 py-1 text-xl leading-none text-ink-muted hover:bg-accent-soft hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
