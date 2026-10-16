/** The paper's claims, with where each stands: untouched, in progress, or finished. */

import { Check, CircleDot, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '../../../components/ui'
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
}: {
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

  // Keep the current chip in view when the strip scrolls sideways.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (chip && typeof chip.scrollIntoView === 'function') chip.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  return (
    <nav aria-label="Claims of this paper" className="flex flex-col gap-2">
      {/* On a phone the add button gets its own row, so the strip shows seven chips, not three. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <ol ref={strip} className="flex w-full min-w-0 flex-1 gap-1.5 overflow-x-auto py-1">
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
                    'flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-2 text-sm tabular-nums transition-colors',
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
        <Button variant="ghost" className="shrink-0" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          <Plus className="size-4" />
          Add a missed claim
        </Button>
      </div>

      {adding && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim()) return
            onAdd(text.trim())
            setText('')
            setAdding(false)
          }}
        >
          <label htmlFor={field} className="text-sm font-medium text-ink">
            A claim extraction missed
          </label>
          <textarea
            id={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={4000}
            autoFocus
            className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!text.trim()}>
              Add claim
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </nav>
  )
}
