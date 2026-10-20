/**
 * "Export ▾" in the editor's top bar (Figma 565:4207): a menu of the four things the author
 * can take away, with a warning at the foot while issues are open. The button follows the
 * menu-button pattern: arrow keys and Home/End move between items, Enter/Space activate,
 * Escape or a click outside closes and focus goes back to the button.
 */

import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { cn } from '../../../../lib/utils'

export type ExportKind = 'report' | 'bib' | 'tex' | 'zip'

const ITEMS: { kind: ExportKind; title: string; hint: string }[] = [
  { kind: 'report', title: 'Verification report (PDF)', hint: 'every citation, verdict and evidence' },
  { kind: 'bib', title: 'Updated .bib', hint: 'new and fixed entries merged' },
  { kind: 'tex', title: 'Annotated .tex', hint: '% SecretSource: comments on flagged \\cite' },
  { kind: 'zip', title: 'Project .zip', hint: 'all .tex, .bib and figures' },
]

export function ExportMenu({
  openIssues,
  busy,
  onExport,
}: {
  /** Open issues across the draft, for the footer warning. */
  openIssues: number
  /** Which export is being produced right now, if any (the PDF report takes a moment). */
  busy: ExportKind | null
  /** Returns false to keep the menu open (e.g. the report is not available). */
  onExport: (kind: ExportKind) => void | boolean | Promise<void | boolean>
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus()
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  const choose = async (kind: ExportKind) => {
    const keep = await onExport(kind)
    if (keep !== false) close()
  }

  const onMenuKey = (event: React.KeyboardEvent) => {
    const last = ITEMS.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((i) => (i >= last ? 0 : i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((i) => (i <= 0 ? last : i - 1))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(last)
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        close(false)
        break
    }
  }

  const onButtonKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(event.key === 'ArrowDown' ? 0 : ITEMS.length - 1)
      setOpen(true)
    }
  }

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          setActive(0)
          setOpen((v) => !v)
        }}
        onKeyDown={onButtonKey}
        className={cn(
          'border-b-2 border-transparent px-1 pt-[19px] pb-[15px] text-[15px] font-medium text-ink transition-colors hover:text-accent',
          open && 'text-accent',
        )}
      >
        Export <span aria-hidden="true" className="text-xs">▾</span>
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-30 mt-px flex w-[280px] flex-col rounded-lg border border-border-subtle bg-surface py-1.5 shadow-xl"
        >
          {ITEMS.map((item, index) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              tabIndex={index === active ? 0 : -1}
              aria-describedby={`${id}-${item.kind}-hint`}
              aria-busy={busy === item.kind}
              disabled={busy !== null && busy !== item.kind}
              onMouseEnter={() => setActive(index)}
              onClick={() => void choose(item.kind)}
              className="flex flex-col items-start gap-px px-4 py-1.5 text-left hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-sm text-ink">
                {item.title}
                {busy === item.kind && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
              </span>
              <span id={`${id}-${item.kind}-hint`} className="text-[11px] text-ink-muted">
                {item.hint}
              </span>
            </button>
          ))}
          {openIssues > 0 && (
            <p className="mt-1 border-t border-border-subtle px-4 pt-2 pb-1 text-[11px] text-refutes">
              {openIssues} issue{openIssues === 1 ? '' : 's'} still open — the report will list {openIssues === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
