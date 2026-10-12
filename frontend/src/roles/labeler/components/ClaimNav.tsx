/** The paper's claims, with where each stands: untouched, in progress, or finished. */

import { Check, CircleDot, Plus } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '../../../components/ui'
import { emptyDraft, isDone, type Draft, type WorkClaim } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

function Mark({ claim, draft }: { claim: WorkClaim; draft: Draft }) {
  if (isDone(claim, draft)) return <Check aria-hidden className="size-3.5 shrink-0 text-supports" />
  if (draft.status) return <CircleDot aria-hidden className="size-3.5 shrink-0 text-insufficient" />
  return null
}

const stateWord = (claim: WorkClaim, draft: Draft) =>
  isDone(claim, draft) ? 'finished' : draft.status ? 'in progress' : 'not started'

/** The claims as a strip of numbered chips: a glance shows where you are and what is left. */
export function ClaimNav({
  claims,
  drafts,
  current,
  onSelect,
  onAdd,
}: {
  claims: WorkClaim[]
  drafts: Record<string, Draft>
  current: string
  onSelect: (id: string) => void
  onAdd: (text: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const field = useId()

  return (
    <nav aria-label="Claims of this paper" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ol className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1">
          {claims.map((claim, index) => {
            const draft = drafts[claim.claim_id] ?? emptyDraft()
            const text = draft.status === 'edited' && draft.edited ? draft.edited : claim.claim
            const here = claim.claim_id === current
            return (
              <li key={claim.claim_id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(claim.claim_id)}
                  aria-current={here ? 'true' : undefined}
                  aria-label={`Claim ${index + 1}, ${stateWord(claim, draft)}: ${text}`}
                  title={text}
                  className={cn(
                    'flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border px-2 text-sm tabular-nums transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    here
                      ? 'border-accent bg-accent-soft font-semibold text-ink'
                      : 'border-border-subtle bg-surface text-ink-muted hover:border-accent hover:text-ink',
                    draft.status === 'rejected' && 'line-through',
                  )}
                >
                  {index + 1}
                  <Mark claim={claim} draft={draft} />
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
          <label htmlFor={field} className="text-xs font-medium text-ink">
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
