/**
 * The passages retrieval found for a claim, grouped by reference paper. Each paper is one section:
 * its passages (each judged by hand: does it bear on the claim or not?), the ones the person added
 * for it, and the level form for it. Clicking a passage shows it in the reference viewer, and the
 * focused one is shown in full. Below, a form to add a passage retrieval missed.
 */

import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Button, IconButton, Input, Textarea } from '../../../components/ui'
import {
  referenceFinished,
  referenceSummary,
  referencesOf,
  uncheckedPlain,
  type AddedPassage,
  type Candidate,
  type CandidateStatus,
  type Draft,
  type Reference,
  type WorkClaim,
} from '../../../lib/labeling'
import { askTarget } from '../../../lib/askCursor'
import { cn } from '../../../lib/utils'
import type { AskedPassage } from './AskPanel'
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
  status,
  onFocus,
  onJudge,
  onAsk,
}: {
  c: Candidate
  label: string
  shown: boolean
  status: CandidateStatus | undefined
  onFocus: () => void
  onJudge: (status: CandidateStatus) => void
  onAsk?: () => void
}) {
  const ref = useReveal(shown)
  return (
    <li
      ref={ref}
      data-ask-target={askTarget({ kind: 'passage', id: c.cand_id })}
      className={cn(
        'scroll-mb-48 rounded-lg border p-3 transition-colors',
        shown ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface',
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-pressed={shown}
        className="w-full rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="text-xs font-semibold text-ink">
          #{c.rank}
          {c.page != null && <span className="font-normal text-ink-muted"> · p.{c.page}</span>}
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
      {onAsk && <AskAboutButton onAsk={onAsk} />}
    </li>
  )
}

function AddedCard({
  a,
  shown,
  onFocus,
  onRemove,
  onAsk,
}: {
  a: AddedPassage
  shown: boolean
  onFocus: () => void
  onRemove: () => void
  onAsk?: () => void
}) {
  const ref = useReveal(shown)
  return (
    <li
      ref={ref}
      className={cn(
        'scroll-mb-48 flex flex-col rounded-lg border p-3',
        shown ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface',
      )}
    >
      <div className="flex items-start gap-2">
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
  focus,
  onFocus,
  onJudge,
  onAdd,
  onRemove,
  grade,
  search,
  onSearchAgain,
  onAsk,
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
  /** The live search for a claim with no stored passages, while it runs or after it failed. */
  search?: 'searching' | 'failed'
  onSearchAgain?: () => void
  /** Ask AI about one passage; without it the cards have no Ask button. */
  onAsk?: (passage: AskedPassage) => void
}) {
  const fileOf = (id: string) => references.find((r) => r.reference_id === id)?.file ?? ''
  const labelOf = (id: string) => references.find((r) => r.reference_id === id)?.label ?? id
  // Missing on a gateway older than the field: there is then nothing to explain.
  const missed = claim.unchecked ?? []
  // true: keep open, false: keep folded. Unset follows the work: open while unfinished or focused.
  const [forced, setForced] = useState<Record<string, boolean>>({})
  return (
    <section aria-labelledby="passages-title" className="flex flex-col gap-4">
      <h3 id="passages-title" className="font-serif text-base font-semibold text-ink">
        Passages retrieval found
      </h3>
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
      {!search && claim.candidates.length === 0 && (
        <div className="flex flex-col gap-2 text-sm text-ink-muted">
          <p>No passages were stored for this claim. Add what supports it below.</p>
          {missed.length > 0 && (
            <ul aria-label="Citations that were not checked" className="flex list-disc flex-col gap-1 pl-5">
              {missed.map((row, index) => (
                <li key={`${row.ref}:${index}`}>
                  {row.label}: {uncheckedPlain(row.reason)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {referencesOf(claim, draft).map((id) => {
        const cands = claim.candidates.filter((c) => c.reference_id === id).sort((a, b) => a.rank - b.rank)
        const added = draft.added.filter((a) => a.reference_id === id)
        const finished = referenceFinished(claim, draft, id)
        const focusedHere = Boolean(
          focus &&
            (cands.some((c) => c.cand_id === focus.key) ||
              added.some((a) => focus.key === `added:${a.reference_id}:${a.passage}`) ||
              focus.key === `ref:${id}`),
        )
        const open = !finished || forced[id] === true || (forced[id] === undefined && focusedHere)
        const reference = references.find((r) => r.reference_id === id)
        return (
          <section key={id} aria-label={labelOf(id)} data-ask-target={askTarget({ kind: 'reference', id })} className="flex flex-col gap-2">
            {finished ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setForced((all) => ({ ...all, [id]: !open }))}
                className="rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-left text-sm font-medium text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                {referenceSummary(claim, draft, reference, id)}
              </button>
            ) : (
              <h4 className="font-serif text-base font-semibold text-ink">{labelOf(id)}</h4>
            )}
            {open && cands.length > 0 && (
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
                    onAsk={
                      onAsk &&
                      (() => onAsk({ referenceId: id, name: `#${c.rank} ${labelOf(id)}`, page: c.page, text: c.passage }))
                    }
                  />
                ))}
              </ul>
            )}
            {open && added.length > 0 && (
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
            {open && grade(id)}
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
