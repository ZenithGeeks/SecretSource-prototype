/** The first decision for a claim: is it a real claim of the paper? Keep it, fix it, or reject it. */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { editNotReworded, REWORD, type ClaimStatus, type Draft, type WorkClaim } from '../../../lib/labeling'
import { askTarget } from '../../../lib/askCursor'
import { printedMarkers, tidyClaim } from '../../../lib/claimText'
import { onRadioKeys, radioTabIndex } from '../../../lib/roving'
import { cn } from '../../../lib/utils'
import { Textarea, TextButton } from '../../../components/ui'

const CHOICES: { status: ClaimStatus; label: string; hint: string; key: string }[] = [
  { status: 'accepted', label: 'Keep', hint: 'Yes, and it is worded right', key: 'K' },
  { status: 'edited', label: 'Edit', hint: 'Yes, but reword it', key: 'E' },
  { status: 'rejected', label: 'Reject', hint: 'No, it is not a claim of this paper', key: 'X' },
]
const QUESTION = 'Is this a claim the paper makes?'

/** The claim (or its edited wording) pinned so it stays in view while the passages scroll.
 * Shown whole, since the wording is what gets judged; only a claim past four lines is cut, with
 * a button to show the rest. */
export function ClaimSticky({
  heading,
  text,
  rejected,
  className,
}: {
  /** The claim's heading, shown above its wording. */
  heading?: ReactNode
  text: string
  rejected?: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [cut, setCut] = useState(false)
  const box = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    /* v8 ignore next -- @preserve */
    if (!el || expanded) return
    setCut(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])
  return (
    <section aria-label="Claim being judged" className={cn('border-b border-border-subtle bg-surface px-4 py-2', className)}>
      {heading}
      <p
        ref={box}
        className={cn('text-sm leading-5 text-ink wrap-anywhere', !expanded && 'line-clamp-4', rejected && 'line-through opacity-70')}
      >
        {tidyClaim(text)}
      </p>
      {(cut || expanded) && (
        <TextButton aria-expanded={expanded} onClick={() => setExpanded((open) => !open)} className="text-xs">
          {expanded ? 'Show less' : 'Show the full claim'}
        </TextButton>
      )}
    </section>
  )
}

/** "Claim 3 of 20", with a note on a claim added by hand. */
export function ClaimHeading({ claim, position, count, id }: { claim: WorkClaim; position: number; count: number; id?: string }) {
  return (
    <h3 id={id} className="font-serif text-base font-semibold text-ink">
      Claim {position} of {count}
      {claim.origin === 'human_added' && <span className="text-sm font-normal text-accent"> · added</span>}
    </h3>
  )
}

/** A key cap. Hidden from screen readers by default: the button carries `aria-keyshortcuts`. */
export function Kbd({ children, hidden = true }: { children: string; hidden?: boolean }) {
  return (
    <kbd
      aria-hidden={hidden || undefined}
      className="rounded-sm border border-border-subtle bg-canvas px-1 font-mono text-caption leading-4 text-ink-muted"
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
  pinned = false,
  onChange,
  onClear,
  clearLabel = 'Clear decision',
  markers = [],
  editPicks = 0,
  decisionTurns = 0,
  warnReword = false,
  onRewordBlur,
}: {
  claim: WorkClaim
  draft: Draft
  position: number
  count: number
  /** The claim wording is already pinned at the top of the panel, so the sentence quote
   * below would repeat it. */
  pinned?: boolean
  onChange: (patch: Partial<Draft>) => void
  /** Puts the claim back as it was saved; given only while there is an unsaved decision. */
  onClear?: () => void
  /** What the button drops: "Discard changes to this claim" back to a saved decision, "Clear decision" when it empties it. */
  clearLabel?: string
  /** The paper's citation markers, to show the numbers it prints in place of reference ids. */
  markers?: { ref: string; text: string }[]
  /** Counts the times the labeler picked Edit, by click or key: each new pick focuses the reword box. */
  editPicks?: number
  /** Counts the times the decision takes the focus: after Clear or Discard, whose button goes away,
   * and after an undo puts a decision back. Never the reword box, where the next key would be typed. */
  decisionTurns?: number
  /** The labeler tried to save the unchanged wording: the reword note turns from a hint to a warning. */
  warnReword?: boolean
  /** Called when the reword box loses focus with the wording unchanged. */
  onRewordBlur?: () => void
}) {
  const name = useId()
  const edit = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const section = useRef<HTMLElement>(null)
  const [reopened, setReopened] = useState<string | null>(null)
  const choice = CHOICES.find((item) => item.status === draft.status)
  const collapsed = Boolean(choice) && reopened !== claim.claim_id
  const reword = editNotReworded(claim, draft)
  // Focus the box only when the labeler picks Edit. An undo, a discard or another claim can put
  // a claim back in Edit too, and focus there would type the next shortcut key into the claim.
  const editsSeen = useRef(editPicks)
  useEffect(() => {
    if (editPicks === editsSeen.current) return
    editsSeen.current = editPicks
    box.current?.focus()
  }, [editPicks])
  const decisionsSeen = useRef(decisionTurns)
  useEffect(() => {
    if (decisionTurns === decisionsSeen.current) return
    decisionsSeen.current = decisionTurns
    // The chosen card, else Keep; collapsed, the one button that reopens the choice.
    const target =
      section.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      section.current?.querySelector<HTMLElement>('[role="radio"], [aria-expanded]')
    target?.focus({ preventScroll: true })
  }, [decisionTurns])
  return (
    // The target of the Workspace's "Skip to the decision" link.
    <section
      ref={section}
      id="claim-decision"
      tabIndex={-1}
      aria-labelledby={pinned ? undefined : `${name}-title`}
      aria-label={pinned ? `Claim ${position} of ${count}` : undefined}
      data-ask-target={askTarget({ kind: 'claim', id: claim.claim_id })}
      className="flex flex-col gap-3 focus:outline-none"
    >
      {/* Pinned, the heading moves up with the claim's wording, so it is read before the claim. */}
      {!pinned && <ClaimHeading id={`${name}-title`} claim={claim} position={position} count={count} />}
      {!draft.status && (
        <p className="text-reading leading-6 text-ink wrap-anywhere">{tidyClaim(claim.claim)}</p>
      )}
      {!pinned && !draft.status && claim.sentence && claim.sentence !== claim.claim && (
        <p className="border-l-2 border-border-subtle pl-3 text-ui leading-5 text-ink-muted wrap-anywhere">
          The paper says: “{printedMarkers(claim.sentence, markers)}”
        </p>
      )}

      {!collapsed && (
        <p id={`${name}-question`} className="text-sm font-medium text-ink">
          {QUESTION}
        </p>
      )}
      {/* The whole flow in one line, for a first claim: the level form only appears after Keep. */}
      {!draft.status && (
        <p className="text-xs text-ink-muted">Decide on the claim first. Its passages, and a 1–4 level for each reference, come after Keep or Edit.</p>
      )}
      {collapsed && choice ? (
        <button
          type="button"
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
        onKeyDown={onRadioKeys}
        className="grid grid-cols-3 gap-2"
      >
        {CHOICES.map(({ status, label, hint, key }, index) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={draft.status === status}
            tabIndex={radioTabIndex(draft.status === status, index, CHOICES.some((c) => c.status === draft.status))}
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

      {onClear && (
        <TextButton onClick={onClear} className="self-start text-xs">
          {clearLabel}
        </TextButton>
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
            onBlur={() => reword && onRewordBlur?.()}
            aria-describedby={reword ? `${edit}-reword` : undefined}
            rows={3}
            maxLength={4000}
          />
          {reword && (
            <p id={`${edit}-reword`} className={cn('text-xs', warnReword ? 'font-medium text-refutes' : 'text-ink-muted')}>
              {REWORD}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
