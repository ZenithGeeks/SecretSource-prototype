/**
 * "Add papers": the one primary action on the Library toolbar. Every way of adding a paper
 * lives in this menu. The caller passes only the items whose action exists.
 */

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../../components/ui'

export type LibraryAddItem = { label: string; hint: string; onSelect: () => void }

export function LibraryAddMenu({ items }: { items: LibraryAddItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (items.length === 0) return null
  return (
    <div ref={root} className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <Button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="gap-2 rounded-[9px] px-3 py-[7px] text-[13px]"
      >
        Add papers
        <ChevronDown className="size-4" />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Add papers"
          className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
            >
              <span className="text-[13px] font-medium text-ink">{item.label}</span>
              <span className="text-xs text-ink-muted">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
