/** The first decision for a claim: is it a real claim of the paper? Keep it, fix it, or reject it. */

import { useEffect, useId, useRef, useState } from 'react'

import type { ClaimStatus, Draft, WorkClaim } from '../../../lib/labeling'
import { askTarget } from '../../../lib/askCursor'
import { cn } from '../../../lib/utils'
import { Textarea } from '../../../components/ui'

const CHOICES: { status: ClaimStatus; label: string; hint: string; key: string }[] = [
  { status: 'accepted', label: 'Keep', hint: 'Yes, and it is worded right', key: 'K' },
  { status: 'edited', label: 'Edit', hint: 'Yes, but reword it', key: 'E' },
  { status: 'rejected', label: 'Reject', hint: 'No, it is not a claim of this paper', key: 'X' },
]
const QUESTION = 'Is this a claim the paper makes?'

/** The claim (or its edited wording) pinned so it stays in view while the passages scroll. */
export function ClaimSticky({
  text,
  rejected,
  className,
}: {
  text: string
  rejected?: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section aria-label="Claim being judged" className={cn('border-b border-border-subtle bg-surface px-4 py-2', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide the claim' : 'Show the full claim'}
        onClick={() => setExpanded((open) => !open)}
        className="w-full rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span
          className={cn(
            'block text-sm leading-5 text-ink',
            !expanded && 'line-clamp-2',
            rejected && 'line-through opacity-70',
          )}
        >
          {text}
        </span>
      </button>
    </section>
  )
}

/** A key cap. Hidden from screen readers by default: the button carries `aria-keyshortcuts`. */
export function Kbd({ children, hidden = true }: { children: string; hidden?: boolean }) {
  return (
    <kbd
      aria-hidden={hidden || undefined}
      className="rounded border border-border-subtle bg-canvas px-1 font-mono text-[11px] leading-4 text-ink-muted"
    >
      {children}
    </kbd>
  )
}

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
  const box = useRef<HTMLTextAreaElement>(null)
  const [reopened, setReopened] = useState<string | null>(null)
  const choice = CHOICES.find((item) => item.status === draft.status)
  const collapsed = Boolean(choice) && reopened !== claim.claim_id
  // Focus the box when Edit is chosen, not when a claim already being edited is opened again:
  // focus there would make the next shortcut key type into the claim.
  const seen = useRef({ claim: claim.claim_id, status: draft.status })
  useEffect(() => {
    const before = seen.current
    seen.current = { claim: claim.claim_id, status: draft.status }
    if (draft.status === 'edited' && before.claim === claim.claim_id && before.status !== 'edited') box.current?.focus()
  }, [claim.claim_id, draft.status])
  return (
    <section aria-labelledby={`${name}-title`} data-ask-target={askTarget({ kind: 'claim', id: claim.claim_id })} className="flex flex-col gap-3">
      <h3 id={`${name}-title`} className="font-serif text-base font-semibold text-ink">
        Claim {position} of {count}
        {claim.origin === 'human_added' && <span className="text-sm font-normal text-accent"> · added</span>}
      </h3>
      {!draft.status && (
        <p className="text-[15px] leading-6 text-ink">{claim.claim}</p>
      )}
      {claim.sentence && claim.sentence !== claim.claim && (
        <p className="border-l-2 border-border-subtle pl-3 text-[13px] leading-5 text-ink-muted">
          The paper says: “{claim.sentence}”
        </p>
      )}

      {!collapsed && (
        <p id={`${name}-question`} className="text-sm font-medium text-ink">
          {QUESTION}
        </p>
      )}
      {collapsed && choice ? (
        <button
          type="button"
          role="radio"
          aria-checked="true"
          aria-expanded={false}
          aria-keyshortcuts={choice.key}
          onClick={() => setReopened(claim.claim_id)}
          className={cn(
            'relative flex min-h-11 flex-col items-start rounded-lg border px-3 py-2 pr-8 text-left',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            choice.status === 'rejected' ? 'border-refutes bg-refutes-soft text-refutes' : 'border-accent bg-accent-soft text-ink',
          )}
        >
          <span className="text-sm font-medium">{choice.label}</span>
          <span className="text-xs">{choice.hint}. Click to change.</span>
          <span className="absolute top-2 right-2">
            <Kbd>{choice.key}</Kbd>
          </span>
        </button>
      ) : (
      <div
        role="radiogroup"
        aria-label="Decision on this claim"
        aria-describedby={`${name}-question`}
        className="grid grid-cols-3 gap-2"
      >
        {CHOICES.map(({ status, label, hint, key }) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={draft.status === status}
            aria-keyshortcuts={key}
            onClick={() => {
              onChange({ status })
              setReopened(null)
            }}
            className={cn(
              'relative flex min-h-11 flex-col items-start rounded-lg border px-3 py-2 pr-8 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              draft.status === status
                ? status === 'rejected'
                  ? 'border-refutes bg-refutes-soft text-refutes'
                  : 'border-accent bg-accent-soft text-ink'
                : 'border-border-subtle bg-surface text-ink-muted hover:border-accent',
            )}
          >
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs">{hint}.</span>
            {/* Last and in a corner, so copied text reads "Keep / Yes, and it is worded right",
                not "KeepKYes...". */}
            <span className="absolute top-2 right-2">
              <Kbd>{key}</Kbd>
            </span>
          </button>
        ))}
      </div>
      )}

      {draft.status === 'edited' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={edit} className="text-sm font-medium text-ink">
            The claim, as it should read
          </label>
          <Textarea
            id={edit}
            ref={box}
            value={draft.edited}
            onChange={(event) => onChange({ edited: event.target.value })}
            rows={3}
            maxLength={4000}
          />
        </div>
      )}
    </section>
  )
}
