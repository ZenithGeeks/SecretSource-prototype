/**
 * The passages retrieval found for a claim, each judged by hand: does it bear on the claim or
 * not? Clicking one shows it in the reference viewer. Below, the passages the person found that
 * retrieval missed, and a form to add one.
 */

import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'

import { Button, Input } from '../../../components/ui'
import type { AddedPassage, CandidateStatus, Draft, Reference, WorkClaim } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

export type Focus = { file: string; passage: string; page: number | null; key: string }

const STATUS: { status: CandidateStatus; label: string }[] = [
  { status: 'relevant', label: 'Relevant' },
  { status: 'rejected', label: 'Not relevant' },
]

export function PassageList({
  claim,
  draft,
  references,
  focus,
  onFocus,
  onJudge,
  onAdd,
  onRemove,
}: {
  claim: WorkClaim
  draft: Draft
  references: Reference[]
  focus: Focus | null
  onFocus: (focus: Focus) => void
  onJudge: (candId: string, status: CandidateStatus) => void
  onAdd: (passage: AddedPassage) => void
  onRemove: (passage: AddedPassage) => void
}) {
  const fileOf = (id: string) => references.find((r) => r.reference_id === id)?.file ?? ''
  const labelOf = (id: string) => references.find((r) => r.reference_id === id)?.label ?? id
  return (
    <section aria-labelledby="passages-title" className="flex flex-col gap-3">
      <h3 id="passages-title" className="font-serif text-base font-semibold text-ink">
        Passages retrieval found
      </h3>
      {claim.candidates.length === 0 && (
        <p className="text-sm text-ink-muted">Retrieval found nothing for this claim. Add what supports it below.</p>
      )}
      <ul className="flex flex-col gap-2">
        {claim.candidates.map((c) => {
          const key = c.cand_id
          const shown = focus?.key === key
          const status = draft.cands[c.cand_id]
          return (
            <li
              key={key}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                shown ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface',
              )}
            >
              <button
                type="button"
                onClick={() => onFocus({ file: c.reference_file, passage: c.passage, page: c.page, key })}
                aria-pressed={shown}
                className="w-full rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">#{c.rank}</span>
                  <span className="truncate">{labelOf(c.reference_id)}</span>
                  {c.page != null && <span>p.{c.page}</span>}
                  {c.score != null && <span className="tabular-nums">score {c.score.toFixed(2)}</span>}
                </span>
                <span className="mt-1 line-clamp-4 block text-[13px] leading-5 text-ink">{c.passage}</span>
              </button>
              <div role="radiogroup" aria-label={`Passage ${c.rank} of ${labelOf(c.reference_id)}`} className="mt-2 flex gap-2">
                {STATUS.map((s) => (
                  <button
                    key={s.status}
                    type="button"
                    role="radio"
                    aria-checked={status === s.status}
                    onClick={() => onJudge(c.cand_id, s.status)}
                    className={cn(
                      'min-h-9 rounded-lg border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent',
                      status === s.status
                        ? s.status === 'relevant'
                          ? 'border-supports bg-supports-soft text-supports'
                          : 'border-refutes bg-refutes-soft text-refutes'
                        : 'border-border-subtle text-ink-muted hover:border-accent',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      {draft.added.length > 0 && (
        <>
          <h4 className="text-sm font-medium text-ink">Passages you added</h4>
          <ul className="flex flex-col gap-2">
            {draft.added.map((a) => {
              const key = `added:${a.reference_id}:${a.passage}`
              return (
                <li key={key} className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface p-3">
                  <button
                    type="button"
                    onClick={() => onFocus({ file: fileOf(a.reference_id), passage: a.passage, page: a.page, key })}
                    className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="block text-xs text-ink-muted">
                      {labelOf(a.reference_id)}
                      {a.page != null && ` · p.${a.page}`}
                    </span>
                    <span className="line-clamp-3 block text-[13px] leading-5 text-ink">{a.passage}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(a)}
                    aria-label="Remove this passage"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-refutes-soft hover:text-refutes focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

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
      <p className="text-xs text-ink-muted">Copy the text from the reference paper on the right.</p>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={ids.ref} className="text-xs font-medium text-ink">
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
          <label htmlFor={ids.page} className="text-xs font-medium text-ink">
            Page
          </label>
          <Input id={ids.page} type="number" min={1} value={page} onChange={(event) => setPage(event.target.value)} />
        </div>
      </div>
      <label htmlFor={ids.text} className="text-xs font-medium text-ink">
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
