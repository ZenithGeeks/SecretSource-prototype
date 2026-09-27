/**
 * The popover that opens on a flagged [n] in the preview (Figma 565:3957): the verdict
 * badge, the source, why, the passage, "Keep mine", and the pager. "Keep mine" is Draft
 * check's "Override · add note" — it opens the same note field and ends in the same gateway
 * call.
 *
 * A non-modal dialog positioned inside the preview's scroll box: Escape or a click outside
 * closes it and focus goes back to the marker that opened it.
 */

import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../../../components/ui'
import type { Citation } from '../../../../types/draftCheck'
import { sourceLabel } from '../../labels'
import { CitationBadge } from '../Verdicts'

export type PopoverAnchor = { top: number; left: number; width: number; height: number }

const WIDTH = 300

export function IssuePopover({
  citation,
  index,
  total,
  anchor,
  containerWidth,
  numberOf,
  onKeepMine,
  onNext,
  onClose,
}: {
  citation: Citation
  /** 0-based position among the file's open issues; -1 when it is not open. */
  index: number
  total: number
  anchor: PopoverAnchor
  containerWidth: number
  /** The reference number a key has in the preview, or null when it is not in the .bib yet. */
  numberOf: (key: string) => number | null
  onKeepMine: (note: string) => void
  onNext: () => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>('button, textarea')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.left, containerWidth - WIDTH - 8))
  const pager = total === 0 ? 'no open issues' : index >= 0 ? `${index + 1} of ${total} issue${total === 1 ? '' : 's'}` : `${total} open issue${total === 1 ? '' : 's'}`

  return (
    <div
      ref={box}
      role="dialog"
      aria-labelledby="issue-popover-title"
      className="absolute z-20 flex flex-col gap-2 rounded-xl border-2 border-refutes bg-surface p-3 shadow-xl"
      style={{ top: anchor.top + anchor.height + 8, left, width: WIDTH }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CitationBadge verdict={citation.verdict} />
        <span id="issue-popover-title" className="text-[11px] text-ink-muted">
          [{numberOf(citation.key) ?? '?'}] {sourceLabel(citation)}
        </span>
      </div>
      {citation.explanation && <p className="text-xs text-ink">{citation.explanation}</p>}
      {citation.evidence?.passage && (
        <blockquote className="font-serif text-xs italic text-ink">
          “{citation.evidence.passage}”{citation.evidence.page ? ` — p.${citation.evidence.page}` : ''}
        </blockquote>
      )}
      {citation.verdict === 'unavailable' && citation.message && <p className="text-xs text-ink-muted">{citation.message}</p>}
      {citation.resolution ? (
        <p className="text-xs text-ink-muted">
          {citation.resolution.kind === 'replaced' ? `Replaced with \\cite{${citation.key}}.` : 'Kept as written.'}
        </p>
      ) : noteOpen ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            onKeepMine(note)
          }}
        >
          <label htmlFor="popover-note" className="text-[11px] font-medium text-ink">
            Why you are keeping this citation
          </label>
          <textarea
            id="popover-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            autoFocus
            className="w-full rounded-lg border border-border-subtle bg-canvas px-2 py-1.5 text-xs"
          />
          <div className="flex gap-2">
            <Button type="submit" className="px-3 py-1.5 text-xs">
              Keep mine
            </Button>
            <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="px-3 py-1.5 text-[13px]" onClick={() => setNoteOpen(true)}>
            Keep mine
          </Button>
        </div>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={total === 0}
        className="flex items-center gap-1 self-start rounded text-[11px] text-accent hover:underline disabled:text-ink-muted disabled:no-underline"
      >
        {pager} · next
        <ChevronRight className="size-3" aria-hidden="true" />
      </button>
    </div>
  )
}
