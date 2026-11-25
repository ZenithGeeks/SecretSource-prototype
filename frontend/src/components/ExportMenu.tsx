/** "Export" in the results toolbar: copy the claims as markdown, or download them as CSV. Both
 * take every claim of the analysis, whatever the standing filter shows. */

import { ChevronDown, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Claim } from '../lib/api'
import { toCsv, toMarkdown } from '../lib/claims'
import { downloadText } from '../lib/csv'
import { useMenuKeys } from '../lib/useMenuKeys'
import { cn } from '../lib/utils'

export const TOOLBAR_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.75 text-ui leading-4.5 font-medium whitespace-nowrap text-ink-muted ' +
  'transition-colors hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function ExportMenu({ claims, paper }: { claims: Claim[]; paper?: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useMenuKeys(open, () => setOpen(false), root)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  async function copyMarkdown() {
    await navigator.clipboard.writeText(toMarkdown(claims, paper))
    setCopied(true)
    setOpen(false)
    setTimeout(() => setCopied(false), 2000)
  }

  const item =
    'flex w-full items-center rounded-lg px-3 py-2 text-left text-ui text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <div ref={root} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur} className="relative">
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
          // A menu holds only items, so its scope is read out with its name; the line below shows it.
          aria-label={`Export all ${claims.length} claims`}
          className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-border-subtle bg-surface p-1 shadow-card"
        >
          <p aria-hidden="true" className="px-3 pt-1.5 pb-1 text-xs text-ink-muted">
            Exports all {claims.length} {claims.length === 1 ? 'claim' : 'claims'}
          </p>
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
