/**
 * The passages retrieval found for a claim, grouped by reference paper. Each paper is one section:
 * its passages (each judged by hand: does it bear on the claim or not?), the ones the person added
 * for it, and the level form for it. Clicking a passage shows it in the reference viewer, and the
 * focused one is shown in full. Below, a form to add a passage retrieval missed.
 */

import { Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Button, Input } from '../../../components/ui'
import {
  referencesOf,
  type AddedPassage,
  type Candidate,
  type CandidateStatus,
  type Draft,
  type Reference,
  type WorkClaim,
} from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { Kbd } from './ClaimDecision'

export type Focus = { file: string; passage: string; page: number | null; key: string }

const STATUS: { status: CandidateStatus; label: string; key: string }[] = [
  { status: 'relevant', label: 'Relevant', key: 'R' },
  { status: 'rejected', label: 'Not relevant', key: 'N' },
]

/** Scrolls a card into view inside the panel when it becomes the focused one (not in jsdom). */
function useReveal(shown: boolean) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const card = ref.current
    if (shown && card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' })
  }, [shown])
  return ref
}

function PassageCard({
  c,
  label,
  shown,
  status,
  onFocus,
  onJudge,
}: {
  c: Candidate
  label: string
  shown: boolean
  status: CandidateStatus | undefined
  onFocus: () => void
  onJudge: (status: CandidateStatus) => void
}) {
  const ref = useReveal(shown)
  return (
    <li
      ref={ref}
      className={cn(
        'rounded-lg border p-3 transition-colors',
        shown ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface',
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-pressed={shown}
        className="w-full rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          <span className="font-semibold text-ink">#{c.rank}</span>
          <span className="truncate">{label}</span>
          {c.page != null && <span>p.{c.page}</span>}
          {c.score != null && <span className="tabular-nums">score {c.score.toFixed(2)}</span>}
        </span>
        <span title={shown ? undefined : c.passage} className={cn('mt-1 block text-sm leading-6 text-ink', !shown && 'line-clamp-3')}>
          {c.passage}
        </span>
      </button>
      <div role="radiogroup" aria-label={`Passage ${c.rank} of ${label}`} className="mt-2 flex gap-2">
        {STATUS.map((s) => (
          <button
            key={s.status}
            type="button"
            role="radio"
            aria-checked={status === s.status}
            aria-keyshortcuts={shown ? s.key : undefined}
            onClick={() => onJudge(s.status)}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent',
              status === s.status
                ? s.status === 'relevant'
                  ? 'border-supports bg-supports-soft text-supports'
                  : 'border-refutes bg-refutes-soft text-refutes'
                : 'border-border-subtle text-ink-muted hover:border-accent',
            )}
          >
            {s.label}
            {shown && <Kbd>{s.key}</Kbd>}
          </button>
        ))}
      </div>
    </li>
  )
}

function AddedCard({
  a,
  shown,
  onFocus,
  onRemove,
}: {
  a: AddedPassage
  shown: boolean
  onFocus: () => void
  onRemove: () => void
}) {
  const ref = useReveal(shown)
  return (
    <li
      ref={ref}
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3',
        shown ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface',
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-pressed={shown}
        className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        {a.page != null && <span className="block text-xs text-ink-muted">p.{a.page}</span>}
        <span title={shown ? undefined : a.passage} className={cn('block text-sm leading-6 text-ink', !shown && 'line-clamp-3')}>
          {a.passage}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this passage"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-refutes-soft hover:text-refutes focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X className="size-4" />
      </button>
    </li>
  )
}

export function PassageList({
  claim,
  draft,
  references,
  focus,
  onFocus,
  onJudge,
  onAdd,
  onRemove,
  grade,
}: {
  claim: WorkClaim
  draft: Draft
  references: Reference[]
  focus: Focus | null
  onFocus: (focus: Focus) => void
  onJudge: (candId: string, status: CandidateStatus) => void
  onAdd: (passage: AddedPassage) => void
  onRemove: (passage: AddedPassage) => void
  /** What goes under one reference's passages: its level form, or a note that it needs a relevant passage. */
  grade: (referenceId: string) => ReactNode
}) {
  const fileOf = (id: string) => references.find((r) => r.reference_id === id)?.file ?? ''
  const labelOf = (id: string) => references.find((r) => r.reference_id === id)?.label ?? id
  return (
    <section aria-labelledby="passages-title" className="flex flex-col gap-4">
      <h3 id="passages-title" className="font-serif text-base font-semibold text-ink">
        Passages retrieval found
      </h3>
      {claim.candidates.length === 0 && (
        <p className="text-sm text-ink-muted">Retrieval found nothing for this claim. Add what supports it below.</p>
      )}
      {referencesOf(claim, draft).map((id) => {
        const cands = claim.candidates.filter((c) => c.reference_id === id).sort((a, b) => a.rank - b.rank)
        const added = draft.added.filter((a) => a.reference_id === id)
        return (
          <section key={id} aria-label={labelOf(id)} className="flex flex-col gap-2">
            <h4 className="font-serif text-base font-semibold text-ink">{labelOf(id)}</h4>
            {cands.length > 0 && (
              <ul className="flex flex-col gap-2">
                {cands.map((c) => (
                  <PassageCard
                    key={c.cand_id}
                    c={c}
                    label={labelOf(id)}
                    shown={focus?.key === c.cand_id}
                    status={draft.cands[c.cand_id]}
                    onFocus={() => onFocus({ file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id })}
                    onJudge={(status) => onJudge(c.cand_id, status)}
                  />
                ))}
              </ul>
            )}
            {added.length > 0 && (
              <>
                <p className="text-sm font-medium text-ink">Passages you added</p>
                <ul className="flex flex-col gap-2">
                  {added.map((a) => {
                    const key = `added:${a.reference_id}:${a.passage}`
                    return (
                      <AddedCard
                        key={key}
                        a={a}
                        shown={focus?.key === key}
                        onFocus={() => onFocus({ file: fileOf(a.reference_id), passage: a.passage, page: a.page, key })}
                        onRemove={() => onRemove(a)}
                      />
                    )
                  })}
                </ul>
              </>
            )}
            {grade(id)}
          </section>
        )
      })}

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
                {r.label}
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
      <textarea
        id={ids.text}
        value={passage}
        onChange={(event) => setPassage(event.target.value)}
        rows={3}
        maxLength={4000}
        className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
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
