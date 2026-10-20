/**
 * A filter button that opens a short list of checkboxes, each with how many rows it would
 * show. Picking several values keeps rows that match any of them.
 */

import { CirclePlus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { cn } from '../lib/utils'
import { Badge } from './ui'

export type FacetOption = { value: string; label: string; count: number }

const PANEL_WIDTH = 256 // w-64
const GUTTER = 16

export function FacetFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  // How far to move the panel left so it stays on screen when the button is near the right edge.
  const [shift, setShift] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // Close on a click outside or on Escape, like a menu. Listened for on the document because
  // Safari does not focus a clicked button, so keys may not reach this component.
  // Focus leaving is handled by onBlur below.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  const chosen = options.filter((o) => selected.includes(o.value))

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          const { left } = event.currentTarget.getBoundingClientRect()
          const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * GUTTER)
          setShift(Math.min(0, window.innerWidth - GUTTER - width - left))
          setOpen(!open)
        }}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed px-3 text-sm transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          chosen.length > 0 ? 'border-accent text-ink' : 'border-border-subtle text-ink-muted hover:border-accent hover:text-ink',
        )}
      >
        <CirclePlus className="size-4 shrink-0" aria-hidden="true" />
        {label}
        {chosen.length > 0 && (
          <>
            <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
            {chosen.length > 2 ? (
              <Badge tone="accent">{chosen.length} chosen</Badge>
            ) : (
              chosen.map((o) => (
                <Badge key={o.value} tone="accent">
                  {o.label}
                </Badge>
              ))
            )}
          </>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          style={{ left: shift }}
          className="absolute top-full z-20 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border-subtle bg-surface p-1 shadow-lg"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-ink hover:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-accent"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="size-4 shrink-0 accent-accent focus-visible:outline-none"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className={cn('text-xs tabular-nums', option.count === 0 ? 'text-ink-muted/60' : 'text-ink-muted')}>
                {option.count}
              </span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 min-h-11 rounded-lg border-t border-border-subtle px-3 text-sm text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
