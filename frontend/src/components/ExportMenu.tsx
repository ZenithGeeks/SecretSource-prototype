/** "Export" in the results toolbar: copy the claims as markdown, or download them as CSV. */

import { ChevronDown, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Claim } from '../lib/api'
import { toCsv, toMarkdown } from '../lib/claims'
import { downloadText } from '../lib/csv'
import { cn } from '../lib/utils'

export const TOOLBAR_BUTTON =
  'inline-flex items-center gap-1.5 rounded-[9px] px-3 py-[7px] text-[13px] leading-[18px] font-medium whitespace-nowrap text-ink-muted ' +
  'transition-colors hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function ExportMenu({ claims, paper }: { claims: Claim[]; paper?: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  async function copyMarkdown() {
    await navigator.clipboard.writeText(toMarkdown(claims, paper))
    setCopied(true)
    setOpen(false)
    setTimeout(() => setCopied(false), 2000)
  }

  const item =
    'flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={TOOLBAR_BUTTON}
      >
        <Download className="size-4" aria-hidden="true" />
        {copied ? 'Copied' : 'Export'}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Export"
          className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-border-subtle bg-surface p-1 shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            onClick={copyMarkdown}
            title="Copy every claim and verdict as markdown"
            className={item}
          >
            Copy as markdown
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              downloadText('claims.csv', toCsv(claims), 'text/csv;charset=utf-8')
              setOpen(false)
            }}
            title="Download the claims, their verdicts and their pages as CSV"
            className={item}
          >
            Download CSV
          </button>
        </div>
      )}
    </div>
  )
}
