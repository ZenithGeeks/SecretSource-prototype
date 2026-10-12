/** The first decision for a claim: is it a real claim of the paper? Keep it, fix it, or reject it. */

import { useId } from 'react'

import type { ClaimStatus, Draft, WorkClaim } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

const CHOICES: { status: ClaimStatus; label: string; hint: string }[] = [
  { status: 'accepted', label: 'Keep', hint: 'A real claim, worded right' },
  { status: 'edited', label: 'Edit', hint: 'A real claim, reword it' },
  { status: 'rejected', label: 'Reject', hint: 'Not a claim of this paper' },
]

export function ClaimDecision({
  claim,
  draft,
  position,
  count,
  onChange,
}: {
  claim: WorkClaim
  draft: Draft
  position: number
  count: number
  onChange: (patch: Partial<Draft>) => void
}) {
  const name = useId()
  const edit = useId()
  return (
    <section aria-labelledby={`${name}-title`} className="flex flex-col gap-3">
      <h3 id={`${name}-title`} className="font-serif text-base font-semibold text-ink">
        Claim {position} of {count}
        {claim.origin === 'human_added' && <span className="text-sm font-normal text-accent"> · added</span>}
      </h3>
      <p className={cn('text-[15px] leading-6 text-ink', draft.status === 'rejected' && 'line-through opacity-70')}>
        {claim.claim}
      </p>
      {claim.sentence && claim.sentence !== claim.claim && (
        <p className="border-l-2 border-border-subtle pl-3 text-[13px] leading-5 text-ink-muted">
          The paper says: “{claim.sentence}”
        </p>
      )}

      <div role="radiogroup" aria-label="Decision on this claim" className="grid grid-cols-3 gap-2">
        {CHOICES.map(({ status, label, hint }) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={draft.status === status}
            onClick={() => onChange({ status })}
            className={cn(
              'flex min-h-11 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              draft.status === status
                ? status === 'rejected'
                  ? 'border-refutes bg-refutes-soft text-refutes'
                  : 'border-accent bg-accent-soft text-ink'
                : 'border-border-subtle bg-surface text-ink-muted hover:border-accent',
            )}
          >
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs">{hint}</span>
          </button>
        ))}
      </div>

      {draft.status === 'edited' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={edit} className="text-xs font-medium text-ink">
            The claim, as it should read
          </label>
          <textarea
            id={edit}
            value={draft.edited}
            onChange={(event) => onChange({ edited: event.target.value })}
            rows={3}
            maxLength={4000}
            className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
      )}
    </section>
  )
}
