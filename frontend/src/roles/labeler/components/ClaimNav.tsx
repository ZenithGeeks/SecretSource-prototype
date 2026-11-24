/** The paper's claims, with where each stands: untouched, in progress, or finished. */

import { Check, ChevronLeft, ChevronRight, CircleDot, FileX, Plus } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Button, Textarea } from '../../../components/ui'
import { tidyClaim } from '../../../lib/claimText'
import { emptyDraft, isDone, sameDraft, type Draft, type Reference, type WorkClaim } from '../../../lib/labeling'
import { moveFocus } from '../../../lib/roving'
import { cn } from '../../../lib/utils'

/** Finished means decided everywhere and written down: an unsaved draft is not finished. */
function Mark({ finished, unsaved, draft }: { finished: boolean; unsaved: boolean; draft: Draft }) {
  if (unsaved) return <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
  if (finished) return <Check aria-hidden className="size-3.5 shrink-0 text-supports" />
  if (draft.status) return <CircleDot aria-hidden className="size-3.5 shrink-0 text-insufficient" />
  return null
}

/** Every decision made but not saved is "ready to save": it is not finished, as it is not written down. */
function stateWord(finished: boolean, ready: boolean, draft: Draft) {
  if (finished) return 'finished'
  if (ready) return 'ready to save'
  return draft.status ? 'in progress' : 'not started'
}

/** The claims as a strip of numbered chips: a glance shows where you are and what is left. */
export function ClaimNav({
  claims,
  drafts,
  saved,
  references,
  current,
  onSelect,
  onAdd,
  className,
  adding,
  setAdding,
  text,
  setText,
  noReference,
}: {
  /** How the strip sits in its parent: the workspace puts it in the header row. */
  className?: string
  claims: WorkClaim[]
  drafts: Record<string, Draft>
  /** Each claim as last written, to tell which drafts are not saved yet. */
  saved: Record<string, Draft>
  references: Reference[]
  current: string
  onSelect: (id: string) => void
  onAdd: (text: string) => void
  adding: boolean
  setAdding: (adding: boolean) => void
  text: string
  setText: (text: string) => void
  /** True for a claim with no passage and no readable cited paper: its chip gets a marker. */
  noReference?: (claim: WorkClaim) => boolean
}) {
  const field = useId()
  const strip = useRef<HTMLOListElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [moreLeft, setMoreLeft] = useState(false)
  const [moreRight, setMoreRight] = useState(false)
  const anyUnreadable = noReference ? claims.some(noReference) : false

  const measureOverflow = useCallback(() => {
    const el = strip.current
    /* v8 ignore next -- @preserve */
    if (!el) return
    setMoreLeft(el.scrollLeft > 4)
    setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  // Closing the form puts the keyboard back on the button that opened it.
  const closeForm = () => {
    setAdding(false)
    addButton.current?.focus()
  }

  // Keep the current chip in view when the strip scrolls sideways.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (chip && typeof chip.scrollIntoView === 'function') chip.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measureOverflow()
  }, [current, claims.length, measureOverflow])

  useEffect(() => {
    const el = strip.current
    /* v8 ignore next -- @preserve */
    if (!el) return
    measureOverflow()
    /* v8 ignore next -- @preserve */
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureOverflow)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [measureOverflow])

  return (
    <nav aria-label="Claims of this paper" className={cn('relative', className)}>
      <div className="flex items-center gap-1.5">
        {moreLeft && (
          <button
            type="button"
            aria-label="Scroll claims left"
            onClick={() => strip.current?.scrollBy({ left: -160, behavior: 'smooth' })}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-ink-muted hover:border-accent hover:text-ink"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        )}
        {/* The scrollbar is hidden: it added a row of height, and the current chip scrolls into view. */}
        {/* One Tab stop for the whole strip (the current claim); the arrow keys move along it. */}
        <ol
          ref={strip}
          onScroll={measureOverflow}
          // Arrow keys, Home and End move along the chips without opening a claim; the ends stop.
          onKeyDown={(event) => moveFocus(event, 'li > button', false)}
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          {claims.map((claim, index) => {
            const draft = drafts[claim.claim_id] ?? emptyDraft()
            const text = tidyClaim(draft.status === 'edited' && draft.edited ? draft.edited : claim.claim)
            const here = claim.claim_id === current
            const unsaved = !sameDraft(draft, saved[claim.claim_id])
            const decided = isDone(claim, draft, references)
            const finished = decided && !unsaved
            const ready = decided && unsaved
            const unreadable = noReference?.(claim) ?? false
            return (
              <li key={claim.claim_id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(claim.claim_id)}
                  aria-current={here ? 'true' : undefined}
                  tabIndex={here ? 0 : -1}
                  aria-label={`Claim ${index + 1}, ${stateWord(finished, ready, draft)}${unsaved && !ready ? ', unsaved' : ''}${unreadable ? ', no reference to read' : ''}: ${text}`}
                  title={[unreadable && 'No reference to read.', ready ? 'Ready to save.' : unsaved && 'Unsaved.', text].filter(Boolean).join(' ')}
                  className={cn(
                    // 32px with a mouse, 44px under a finger.
                    'flex h-8 min-w-7 items-center justify-center gap-0.5 rounded-lg border px-1 text-sm tabular-nums transition-colors pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-2',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    here && 'border-accent bg-accent-soft font-semibold text-ink',
                    !here && 'border-border-subtle bg-surface text-ink-muted hover:border-accent hover:text-ink',
                    // Fill is kept for progress. Nothing opens for this claim, so it gets an icon and a
                    // dotted outline, and is dimmed: in a blind check most chips are like this, and the
                    // few with a reference to read must stand out. Still clickable, so not greyed out.
                    unreadable && 'border-dotted',
                    unreadable && !here && 'border-ink-muted opacity-60',
                    draft.status === 'rejected' && 'line-through',
                  )}
                >
                  {index + 1}
                  {unreadable && <FileX aria-hidden className="size-3.5 shrink-0" />}
                  <Mark finished={finished} unsaved={unsaved} draft={draft} />
                </button>
              </li>
            )
          })}
        </ol>
        {moreRight && (
          <button
            type="button"
            aria-label="More claims"
            onClick={() => strip.current?.scrollBy({ left: 160, behavior: 'smooth' })}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-ink-muted hover:border-accent hover:text-ink"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        )}
        {/* A key for the dimmed chips, after them and with no chip of its own, so it is not read as
            news about the current claim. The chips carry the words for a screen reader. */}
        {anyUnreadable && (
          <span aria-hidden className="flex shrink-0 items-center gap-1 text-caption whitespace-nowrap text-ink-muted">
            <FileX className="size-3.5" />= no reference to read
          </span>
        )}
        <button
          ref={addButton}
          type="button"
          aria-expanded={adding}
          aria-label="Add a missed claim"
          title="Add a missed claim"
          onClick={() => setAdding(!adding)}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-subtle text-ink-muted hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent pointer-coarse:size-11"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      {adding && (
        // Opens over the page below, so adding a claim does not push the workspace down. Under its
        // button at the strip's right end, and above the viewer's toolbar (z-30).
        <form
          className="absolute right-0 top-full z-40 mt-1 flex w-[min(32rem,100%)] flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeForm()
          }}
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim()) return
            onAdd(text.trim())
            setText('')
            closeForm()
          }}
        >
          <label htmlFor={field} className="text-sm font-medium text-ink">
            A claim extraction missed
          </label>
          <Textarea
            id={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={4000}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!text.trim()}>
              Add claim
            </Button>
            <Button type="button" variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </nav>
  )
}
