/**
 * The passages retrieval found for a claim, grouped by reference paper. Each paper is one section:
 * its passages (each judged by hand: does it bear on the claim or not?), the ones the person added
 * for it, and one level form for it after them, since the level is for the reference as a whole.
 * Clicking a passage, or moving keyboard focus onto it, shows it in the reference viewer and opens
 * the full text. The others stay at three lines. Below, a form to add a passage retrieval missed.
 */

import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Button, IconButton, Input, Textarea } from '../../../components/ui'
import { printedRef } from '../../../lib/claimText'
import {
  byline,
  referenceFinished,
  referenceSummary,
  referencesOf,
  type AddedPassage,
  type Candidate,
  type CandidateStatus,
  type Draft,
  type Reference,
  type WorkClaim,
} from '../../../lib/labeling'
import { askTarget } from '../../../lib/askCursor'
import { onRadioKeys, radioTabIndex } from '../../../lib/roving'
import { cn } from '../../../lib/utils'
import type { AskedPassage } from './AskPanel'
import { Kbd } from './ClaimDecision'

export type Focus = { file: string; passage: string; page: number | null; key: string; automatic?: true }

const STATUS: { status: CandidateStatus; label: string; key: string }[] = [
  { status: 'relevant', label: 'Relevant', key: 'R' },
  { status: 'rejected', label: 'Not relevant', key: 'N' },
]

/** Scrolls `card` into view inside its label panel only. `scrollIntoView` would also scroll
 * every container above it, the locked app shell included, and hide the claim strip. */
export function revealInPanel(card: HTMLElement) {
  const panel = card.closest<HTMLElement>('[data-label-panel]')
  if (!panel) {
    // A narrow screen has no panel of its own: the page scrolls, so the browser's way is right.
    if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' })
    return
  }
  const top = card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop
  const bottom = top + card.offsetHeight
  if (top < panel.scrollTop) panel.scrollTop = top
  else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight
}

/** Reveal explicit focus even on mount (such as after adding a passage), once per focus. */
function useReveal(shouldReveal: boolean) {
  const ref = useRef<HTMLLIElement>(null)
  const revealed = useRef(false)
  useEffect(() => {
    if (shouldReveal && !revealed.current && ref.current) revealInPanel(ref.current)
    revealed.current = shouldReveal
  }, [shouldReveal])
  return ref
}

/** Opens Ask on one passage, under the card's own controls. */
function AskAboutButton({ onAsk }: { onAsk: () => void }) {
  return (
    <button
      type="button"
      onClick={onAsk}
      className="mt-1 flex min-h-8 items-center gap-1.5 self-start rounded-md px-2 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Sparkles className="size-3.5" aria-hidden="true" />
      Ask AI about this passage
    </button>
  )
}

function PassageCard({
  c,
  label,
  shown,
  reveal,
  status,
  onFocus,
  onJudge,
  onAsk,
}: {
  c: Candidate
  label: string
  shown: boolean
  reveal: boolean
  status: CandidateStatus | undefined
  onFocus: () => void
  onJudge: (status: CandidateStatus) => void
  onAsk?: () => void
}) {
  const ref = useReveal(shown && reveal)
  return (
    <li
      ref={ref}
      data-ask-target={askTarget({ kind: 'passage', id: c.cand_id })}
      className={cn(
        'scroll-mb-48 rounded-lg border transition-colors',
        // An outline for the passage the keys act on; fill is left to the Relevant verdict.
        shown ? 'border-accent bg-surface p-3 ring-2 ring-accent' : 'border-border-subtle bg-surface p-2',
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        onFocus={() => {
          // Tabbing onto a clamped passage opens it, the same as a click.
          if (!shown) onFocus()
        }}
        aria-expanded={shown}
        aria-pressed={shown}
        className="w-full rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="text-xs font-semibold text-ink">
          Passage {c.rank}
          {c.page != null && <span className="font-normal text-ink-muted"> · page {c.page}</span>}
        </span>
        {/* `block` and `line-clamp` both set `display`. Keeping both leaves the clamp unset and
            the card at the full passage height. */}
        <span title={shown ? undefined : c.passage} className={cn('mt-1 text-sm leading-6 text-ink wrap-anywhere', shown ? 'block' : 'line-clamp-3')}>
          {c.passage}
        </span>
      </button>
      <div role="radiogroup" aria-label={`Passage ${c.rank} of ${label}`} onKeyDown={onRadioKeys} className="mt-2 flex gap-2">
        {STATUS.map((s, index) => (
          <button
            key={s.status}
            type="button"
            role="radio"
            aria-checked={status === s.status}
            tabIndex={radioTabIndex(status === s.status, index, STATUS.some((option) => option.status === status))}
            aria-keyshortcuts={shown ? s.key : undefined}
            onClick={() => onJudge(s.status)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent',
              shown ? 'min-h-11' : 'min-h-9 pointer-coarse:min-h-11',
              status === s.status
                ? s.status === 'relevant'
                  ? 'border-supports bg-supports-soft text-supports'
                  : 'border-refutes bg-refutes-soft text-refutes'
                : 'border-border-subtle text-ink-muted hover:border-accent',
            )}
          >
            {s.label}
            {/* On every passage, faint except on the one R and N act on. */}
            <span className={cn(!shown && 'opacity-50')}>
              <Kbd>{s.key}</Kbd>
            </span>
          </button>
        ))}
      </div>
      {onAsk && <AskAboutButton onAsk={onAsk} />}
    </li>
  )
}

function AddedCard({
  a,
  shown,
  reveal,
  onFocus,
  onRemove,
  onAsk,
}: {
  a: AddedPassage
  shown: boolean
  reveal: boolean
  onFocus: () => void
  onRemove: () => void
  onAsk?: () => void
}) {
  const ref = useReveal(shown && reveal)
  return (
    <li
      ref={ref}
      className={cn(
        'flex scroll-mb-48 flex-col rounded-lg border',
        shown ? 'border-accent bg-surface p-3 ring-2 ring-accent' : 'border-border-subtle bg-surface p-2',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onFocus}
          onFocus={() => {
            if (!shown) onFocus()
          }}
          aria-expanded={shown}
          aria-pressed={shown}
          className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
        >
          {a.page != null && <span className="block text-xs text-ink-muted">page {a.page}</span>}
          <span title={shown ? undefined : a.passage} className={cn('text-sm leading-6 text-ink wrap-anywhere', shown ? 'block' : 'line-clamp-3')}>
            {a.passage}
          </span>
        </button>
        <IconButton
          onClick={onRemove}
          aria-label="Remove this passage"
          className="lg:size-11 hover:bg-refutes-soft hover:text-refutes"
        >
          <X className="size-4" />
        </IconButton>
      </div>
      {onAsk && <AskAboutButton onAsk={onAsk} />}
    </li>
  )
}

export function PassageList({
  claim,
  draft,
  references,
  markers = [],
  focus,
  onFocus,
  onJudge,
  onAdd,
  onRemove,
  grade,
  empty = 'No passages were stored for this claim. Add what supports it below.',
  search,
  onSearchAgain,
  onAsk,
}: {
  claim: WorkClaim
  draft: Draft
  references: Reference[]
  /** The paper's citation markers, for the reference numbers it prints. */
  markers?: { ref: string; text: string }[]
  focus: Focus | null
  onFocus: (focus: Focus) => void
  onJudge: (candId: string, status: CandidateStatus) => void
  onAdd: (passage: AddedPassage) => void
  onRemove: (passage: AddedPassage) => void
  /** What goes under one reference's passages: its level and reason form. */
  grade: (referenceId: string) => ReactNode
  /** The one line shown when the claim has no passages at all. */
  empty?: string
  /** The live search for a claim with no stored passages, while it runs or after it failed. */
  search?: 'searching' | 'failed'
  onSearchAgain?: () => void
  /** Ask AI about one passage; without it the cards have no Ask button. */
  onAsk?: (passage: AskedPassage) => void
}) {
  // Automatic focus opens the PDF while leaving the label panel at the claim decision.
  const revealFocused = !focus?.automatic
  const fileOf = (id: string) => references.find((r) => r.reference_id === id)?.file ?? ''
  const labelOf = (id: string) => references.find((r) => r.reference_id === id)?.label ?? id
  const shortNameOf = (id: string) => {
    const reference = references.find((r) => r.reference_id === id)
    return (reference && byline(reference)) || labelOf(id)
  }
  const refIds = referencesOf(claim, draft)
  const [pickedRef, setPickedRef] = useState<string | null>(null)
  const focusedRefId = focus
    ? refIds.find(
        (id) =>
          claim.candidates.some((c) => c.reference_id === id && c.cand_id === focus.key) ||
          draft.added.some((a) => a.reference_id === id && focus.key === `added:${a.reference_id}:${a.passage}`) ||
          focus.key === `ref:${id}`,
      )
    : undefined
  const activeId =
    focusedRefId ??
    (pickedRef && refIds.includes(pickedRef) ? pickedRef : undefined) ??
    refIds.find((id) => !referenceFinished(claim, draft, id)) ??
    refIds[0]

  const selectRef = (id: string) => {
    setPickedRef(id)
    const firstCand = claim.candidates.filter((c) => c.reference_id === id).sort((a, b) => a.rank - b.rank)[0]
    if (firstCand) {
      onFocus({ file: firstCand.reference_file, passage: firstCand.passage, page: firstCand.page, key: firstCand.cand_id })
      return
    }
    const firstAdded = draft.added.find((a) => a.reference_id === id)
    /* v8 ignore next -- @preserve */
    if (firstAdded) {
      onFocus({ file: fileOf(id), passage: firstAdded.passage, page: firstAdded.page, key: `added:${firstAdded.reference_id}:${firstAdded.passage}` })
    }
  }

  return (
    <section aria-labelledby={refIds.length > 0 ? 'passages-title' : undefined} aria-label={refIds.length > 0 ? undefined : 'Passages'} className="flex flex-col gap-3">
      {refIds.length > 0 && (
        <h3 id="passages-title" className="font-serif text-base font-semibold text-ink">
          {refIds.length === 1 ? `Passages found in ${shortNameOf(refIds[0])}` : 'Passages found in the cited papers'}
        </h3>
      )}
      {search === 'searching' && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Searching the reference papers for this claim…
        </p>
      )}
      {search === 'failed' && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-refutes">
          Retrieval did not answer, so only passages you add are listed.
          <Button type="button" variant="ghost" onClick={onSearchAgain}>
            Search again
          </Button>
        </p>
      )}
      {!search && claim.candidates.length === 0 && <p className="text-sm text-ink-muted">{empty}</p>}
      {refIds.length > 1 && (
        <div role="tablist" aria-label="References for this claim" className="flex flex-wrap gap-1.5">
          {refIds.map((id) => {
            const finished = referenceFinished(claim, draft, id)
            const reference = references.find((r) => r.reference_id === id)
            const active = id === activeId
            const printed = reference ? printedRef(reference, markers) : ''
            const tag = printed ? `${printed} ${labelOf(id)}` : labelOf(id)
            const text = finished ? referenceSummary(claim, draft, reference, id) : tag
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectRef(id)}
                title={text}
                className={cn(
                  'max-w-full truncate rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  // Selected has the accent border and fill; hover only shades the background.
                  active
                    ? 'border-accent bg-accent-soft text-ink'
                    : finished
                      ? 'border-border-subtle bg-canvas text-ink-muted hover:text-ink'
                      : 'border-border-subtle bg-surface text-ink hover:bg-canvas',
                )}
              >
                {text}
              </button>
            )
          })}
        </div>
      )}
      {activeId && (() => {
        const id = activeId
        const cands = claim.candidates.filter((c) => c.reference_id === id).sort((a, b) => a.rank - b.rank)
        const added = draft.added.filter((a) => a.reference_id === id)
        const addedKey = (a: AddedPassage) => `added:${a.reference_id}:${a.passage}`
        return (
          <section key={id} aria-label={labelOf(id)} data-ask-target={askTarget({ kind: 'reference', id })} className="flex flex-col gap-2">
            {refIds.length === 1 && <h4 className="font-serif text-base font-semibold text-ink">{labelOf(id)}</h4>}
            {cands.length > 0 && (
              <p className="text-caption text-ink-muted pointer-coarse:hidden">R relevant · N not relevant · J/U or ↓/↑ next/previous</p>
            )}
            {cands.length > 0 && (
              <ul className="flex flex-col gap-2">
                {cands.map((c) => (
                  <PassageCard
                    key={c.cand_id}
                    c={c}
                    label={labelOf(id)}
                    shown={focus?.key === c.cand_id}
                    reveal={revealFocused}
                    status={draft.cands[c.cand_id]}
                    onFocus={() => onFocus({ file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id })}
                    onJudge={(status) => onJudge(c.cand_id, status)}
                    onAsk={
                      onAsk &&
                      (() => onAsk({ referenceId: id, name: `Passage ${c.rank} · ${labelOf(id)}`, page: c.page, text: c.passage }))
                    }
                  />
                ))}
              </ul>
            )}
            {added.length > 0 && (
              <>
                <p className="text-sm font-medium text-ink">Passages you added</p>
                <ul className="flex flex-col gap-2">
                  {added.map((a) => {
                    const key = addedKey(a)
                    return (
                      <AddedCard
                        key={key}
                        a={a}
                        shown={focus?.key === key}
                        reveal={revealFocused}
                        onFocus={() => onFocus({ file: fileOf(a.reference_id), passage: a.passage, page: a.page, key })}
                        onRemove={() => onRemove(a)}
                        onAsk={
                          // Ask reads the reference's PDF, which a work with no PDF does not have.
                          onAsk && fileOf(id)
                            ? () => onAsk({ referenceId: id, name: `Yours · ${labelOf(id)}`, page: a.page, text: a.passage })
                            : undefined
                        }
                      />
                    )
                  })}
                </ul>
              </>
            )}
            <div data-level-form="">{grade(id)}</div>
          </section>
        )
      })()}

      <AddPassage references={references} onAdd={onAdd} />
    </section>
  )
}

function AddPassage({ references, onAdd }: { references: Reference[]; onAdd: (p: AddedPassage) => void }) {
  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [page, setPage] = useState('')
  const [passage, setPassage] = useState('')
  const ids = { ref: useId(), page: useId(), text: useId() }

  if (!references.length) return null
  if (!open)
    return (
      <Button variant="ghost" className="justify-start" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add a passage retrieval missed
      </Button>
    )
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-dashed border-border-subtle p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const id = reference || references[0].reference_id
        if (!passage.trim()) return
        onAdd({ reference_id: id, page: page ? Number(page) : null, passage: passage.trim() })
        setPassage('')
        setPage('')
        setOpen(false)
      }}
    >
      <p className="text-sm text-ink-muted">
        Paste a passage from the reference here, or select it in the reference's PDF and choose Add as evidence.
      </p>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={ids.ref} className="text-sm font-medium text-ink">
            Reference paper
          </label>
          <select
            id={ids.ref}
            value={reference || references[0].reference_id}
            onChange={(event) => setReference(event.target.value)}
            className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          >
            {references.map((r) => (
              <option key={r.reference_id} value={r.reference_id}>
                {r.file ? r.label : `${r.label} (no PDF)`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-20 flex-col gap-1">
          <label htmlFor={ids.page} className="text-sm font-medium text-ink">
            Page
          </label>
          <Input id={ids.page} type="number" min={1} value={page} onChange={(event) => setPage(event.target.value)} />
        </div>
      </div>
      <label htmlFor={ids.text} className="text-sm font-medium text-ink">
        The passage
      </label>
      <Textarea
        id={ids.text}
        value={passage}
        onChange={(event) => setPassage(event.target.value)}
        rows={3}
        maxLength={4000}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={!passage.trim()}>
          Add passage
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
