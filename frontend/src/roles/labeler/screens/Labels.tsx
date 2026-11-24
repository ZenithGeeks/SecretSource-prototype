/** The labels of one paper, read-only: each (claim, reference) pair with every labeler's level,
 * disagreements first, and notes for talking a disagreement through (#1042). A lead sees every
 * pair; anyone else only the pairs they judged, so a blind check stays blind. */

import { ArrowLeft, Tags } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Badge, Button, Empty, FadeIn, LoadingScreen, TextButton, Textarea } from '../../../components/ui'
import {
  LEVELS,
  problem,
  useAddCompareNote,
  useComparison,
  type ComparePair,
  type CompareVerdict,
} from '../../../lib/labeling'

const LEVEL_NAME = Object.fromEntries(LEVELS.map(({ level, name }) => [level, name]))

const SECTIONS = [
  { key: 'disagree', title: 'Labelers disagree', test: (p: ComparePair) => p.verdicts.length > 1 && !p.agree },
  { key: 'agree', title: 'Labelers agree', test: (p: ComparePair) => p.agree },
  { key: 'single', title: 'One labeler so far', test: (p: ComparePair) => p.verdicts.length < 2 },
] as const

export function Labels({ analysisId, onBack, onLabel }: { analysisId: string; onBack: () => void; onLabel: () => void }) {
  const comparison = useComparison(analysisId)

  const back = (
    <TextButton onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm">
      <ArrowLeft className="size-4" aria-hidden />
      Back to papers
    </TextButton>
  )
  if (comparison.isLoading) return <LoadingScreen />
  if (!comparison.data) {
    const forbidden = /^(Error: )?403:/.test(String(comparison.error))
    const { title, hint } = forbidden
      ? { title: 'Label this paper first', hint: 'You can see the other labels once you have saved your own.' }
      : problem(comparison.error)
    return (
      <FadeIn className="flex flex-col gap-4">
        {back}
        <Empty title={title} hint={hint} />
        <Button onClick={onLabel} className="w-fit">
          Label this paper
        </Button>
      </FadeIn>
    )
  }

  const { title, labelers, pairs } = comparison.data
  const disagree = pairs.filter(SECTIONS[0].test).length
  return (
    <FadeIn className="flex flex-col gap-6">
      {back}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-[72ch] flex-col gap-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="text-sm text-ink-muted tabular-nums">
            {labelers.length > 0 ? `Labeled by ${labelers.join(', ')}. ` : ''}
            {pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'}, {disagree} with a disagreement.
          </p>
        </div>
        <Button variant="ghost" onClick={onLabel} className="min-h-10">
          <Tags className="size-4" aria-hidden />
          Label it yourself
        </Button>
      </header>

      {pairs.length === 0 ? (
        <Empty title="No labels yet" hint="Nobody has saved a level on this paper." />
      ) : (
        SECTIONS.map(({ key, title: heading, test }) => {
          const shown = pairs.filter(test)
          if (shown.length === 0) return null
          return (
            <section key={key} aria-labelledby={`labels-${key}`} className="flex flex-col gap-3">
              <h2 id={`labels-${key}`} className="text-sm font-semibold text-ink">
                {heading} <span className="font-normal text-ink-muted tabular-nums">({shown.length})</span>
              </h2>
              <ul className="flex flex-col gap-3">
                {shown.map((pair) => (
                  <PairCard key={`${pair.claim_id}|${pair.reference_id}`} analysisId={analysisId} pair={pair} />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </FadeIn>
  )
}

function PairCard({ analysisId, pair }: { analysisId: string; pair: ComparePair }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink">{pair.claim || <span className="text-ink-muted">(no claim text)</span>}</p>
        <p className="text-xs text-ink-muted">Cited: {pair.reference_title}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {pair.verdicts.map((verdict) => (
          <VerdictRow key={verdict.labeler} verdict={verdict} />
        ))}
      </ul>
      <Notes analysisId={analysisId} pair={pair} />
    </li>
  )
}

function VerdictRow({ verdict }: { verdict: CompareVerdict }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{verdict.labeler}</span>
        {verdict.evidence === null ? (
          <Badge tone="refutes">Rejected the claim</Badge>
        ) : (
          <Badge tone="accent">
            {verdict.evidence} · {LEVEL_NAME[verdict.evidence]}
          </Badge>
        )}
        {verdict.confidence && <span className="text-xs text-ink-muted">{verdict.confidence} confidence</span>}
      </div>
      {verdict.rationale && <p className="text-ink-muted">{verdict.rationale}</p>}
    </li>
  )
}

function Notes({ analysisId, pair }: { analysisId: string; pair: ComparePair }) {
  const [text, setText] = useState('')
  const add = useAddCompareNote(analysisId)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const note = text.trim()
    if (!note) return
    add.mutate({ claim_id: pair.claim_id, reference_id: pair.reference_id, note }, { onSuccess: () => setText('') })
  }
  return (
    <div className="flex flex-col gap-2">
      {pair.notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {pair.notes.map((note) => (
            <li key={`${note.author}|${note.ts}|${note.note}`}>
              <span className="font-medium text-ink">{note.author}</span>{' '}
              <time dateTime={note.ts} className="text-xs text-ink-muted">
                {new Date(note.ts).toLocaleString()}
              </time>
              <p className="text-ink-muted">{note.note}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="sr-only" htmlFor={`note-${pair.claim_id}-${pair.reference_id}`}>
          Note on this pair
        </label>
        <Textarea
          id={`note-${pair.claim_id}-${pair.reference_id}`}
          rows={2}
          maxLength={2000}
          placeholder="Add a note, e.g. why the levels differ"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="ghost" disabled={!text.trim() || add.isPending} className="min-h-9">
            Add note
          </Button>
          {add.isError && (
            <span role="alert" className="text-xs text-refutes">
              The note was not saved: {problem(add.error).title}.
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
