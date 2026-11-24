import { useEffect, useRef, type ReactNode } from 'react'

/** The page viewer over the app when a statement's source is opened. It takes focus, so the
 * keyboard is inside it, and gives focus back to the statement when it closes. */
export function SourceDialog({ label, children }: { label: string; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    return () => opener?.focus()
  }, [])
  return (
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-60 flex items-center justify-center bg-ink/45 p-4 outline-none"
    >
      {children}
    </div>
  )
}
