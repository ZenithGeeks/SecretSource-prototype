/** The paper's claims, with where each stands: untouched, in progress, or finished. */

import { Check, Circle, CircleDot, Plus } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '../../../components/ui'
import { emptyDraft, isDone, type Draft, type WorkClaim } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

function Mark({ claim, draft }: { claim: WorkClaim; draft: Draft }) {
  if (isDone(claim, draft)) return <Check aria-label="finished" className="mt-0.5 size-4 shrink-0 text-supports" />
  if (draft.status) return <CircleDot aria-label="in progress" className="mt-0.5 size-4 shrink-0 text-insufficient" />
  return <Circle aria-label="not started" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
}

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
    <nav aria-label="Claims of this paper" className="flex flex-col gap-1 xl:sticky xl:top-4 xl:self-start">
      <ol className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto xl:max-h-[calc(100vh-14rem)]">
        {claims.map((claim, index) => {
          const draft = drafts[claim.claim_id] ?? emptyDraft()
          return (
            <li key={claim.claim_id}>
              <button
                type="button"
                onClick={() => onSelect(claim.claim_id)}
                aria-current={claim.claim_id === current ? 'true' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] leading-[18px] transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  claim.claim_id === current ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:bg-accent-soft hover:text-ink',
                )}
              >
                <Mark claim={claim} draft={draft} />
                <span className="min-w-0">
                  <span className="mr-1 tabular-nums">{index + 1}.</span>
                  <span className={cn('line-clamp-2', draft.status === 'rejected' && 'line-through')}>
                    {draft.status === 'edited' && draft.edited ? draft.edited : claim.claim}
                  </span>
                  {claim.origin === 'human_added' && <span className="text-accent"> · added</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      {adding ? (
        <form
          className="mt-2 flex flex-col gap-2 px-1"
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
            rows={3}
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
      ) : (
        <Button variant="ghost" className="mt-2 justify-start" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add a missed claim
        </Button>
      )}
    </nav>
  )
}
