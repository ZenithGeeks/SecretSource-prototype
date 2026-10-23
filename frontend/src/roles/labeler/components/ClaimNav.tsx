/** The paper's claims, with where each stands: untouched, in progress, or finished. */

import { Check, CircleDot, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button, Textarea } from '../../../components/ui'
import { emptyDraft, isDone, sameDraft, type Draft, type Reference, type WorkClaim } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

/** Finished means decided everywhere and written down: an unsaved draft is not finished. */
function Mark({ finished, unsaved, draft }: { finished: boolean; unsaved: boolean; draft: Draft }) {
  if (unsaved) return <span aria-hidden title="Unsaved" className="size-2 shrink-0 rounded-full bg-accent" />
  if (finished) return <Check aria-hidden className="size-3.5 shrink-0 text-supports" />
  if (draft.status) return <CircleDot aria-hidden className="size-3.5 shrink-0 text-insufficient" />
  return null
}

const stateWord = (finished: boolean, draft: Draft) => (finished ? 'finished' : draft.status ? 'in progress' : 'not started')

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
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const field = useId()
  const strip = useRef<HTMLOListElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  // Closing the form puts the keyboard back on the button that opened it.
  const closeForm = () => {
    setAdding(false)
    addButton.current?.focus()
  }

  // Keep the current chip in view when the strip scrolls sideways.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (chip && typeof chip.scrollIntoView === 'function') chip.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  return (
    <nav aria-label="Claims of this paper" className={cn('relative', className)}>
      <div className="flex items-center gap-1.5">
        {/* The scrollbar is hidden: it added a row of height, and the current chip scrolls into view. */}
        <ol ref={strip} className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {claims.map((claim, index) => {
            const draft = drafts[claim.claim_id] ?? emptyDraft()
            const text = draft.status === 'edited' && draft.edited ? draft.edited : claim.claim
            const here = claim.claim_id === current
            const unsaved = !sameDraft(draft, saved[claim.claim_id])
            const finished = isDone(claim, draft, references) && !unsaved
            return (
              <li key={claim.claim_id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(claim.claim_id)}
                  aria-current={here ? 'true' : undefined}
                  aria-label={`Claim ${index + 1}, ${stateWord(finished, draft)}${unsaved ? ', unsaved' : ''}: ${text}`}
                  title={text}
                  className={cn(
                    // 32px with a mouse, 44px under a finger.
                    'flex h-8 min-w-7 items-center justify-center gap-0.5 rounded-lg border px-1 text-sm tabular-nums transition-colors pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-2',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    here
                      ? 'border-accent bg-accent-soft font-semibold text-ink'
                      : 'border-border-subtle bg-surface text-ink-muted hover:border-accent hover:text-ink',
                    draft.status === 'rejected' && 'line-through',
                  )}
                >
                  {index + 1}
                  <Mark finished={finished} unsaved={unsaved} draft={draft} />
                </button>
              </li>
            )
          })}
        </ol>
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
        // Opens over the page below, so adding a claim does not push the workspace down.
        <form
          className="absolute left-0 top-full z-20 mt-1 flex w-[min(32rem,100%)] flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3 shadow-lg"
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
