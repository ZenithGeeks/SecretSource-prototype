/**
 * Ask AI in the labeler, for the claim on screen: a review of what the person saved, and
 * questions about the paper or one of the references it cites. The review points things out and
 * never changes a label (docs/labeling.md). The workspace keys this panel by claim, so moving to
 * another claim starts it afresh and stops a review still running.
 */

import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Mascot } from '../../../components/Mascot'
import { Button } from '../../../components/ui'
import type { Statement } from '../../../lib/assistant'
import {
  askLabeling,
  problem,
  reviewClaim,
  type Finding,
  type Reference,
  type ReviewEvent,
  type WorkClaim,
} from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { TONES, type Pointing } from '../../../lib/askCursor'

const DWELL_MS = 1100 // how long the cursor stays on each finding before the next one

const VERDICTS: Record<string, string> = {
  supports: 'Backed',
  insufficient: 'Not backed',
  refutes: 'Contradicted',
  unchecked: "Can't check",
  error: "Can't check",
}

type Answer = { question: string; statements: Statement[]; status: 'answering' | 'done' | 'failed'; error?: string }

export function AskPanel({
  analysisId,
  claim,
  references,
  reviewBlocked,
  onPoint,
}: {
  analysisId: string
  claim: WorkClaim
  references: Reference[]
  /** Why the review cannot run yet (nothing saved, or unsaved changes), or null. */
  reviewBlocked: string | null
  onPoint: (pointing: Pointing | null) => void
}) {
  const review = useReview(analysisId, claim.claim_id, onPoint)
  const cited = references.filter((r) => claim.candidates.some((c) => c.reference_id === r.reference_id))

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="ask-review-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id="ask-review-title" className="text-sm font-semibold text-ink">
            Review this claim
          </h3>
          <Button
            variant="ghost"
            disabled={Boolean(reviewBlocked) || review.status === 'reviewing'}
            onClick={review.start}
            className="min-h-9 text-accent"
          >
            {review.status === 'reviewing' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
            {review.status === 'done' ? 'Review again' : 'Review'}
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          {reviewBlocked ?? 'Checks what you saved: passages left, levels without a reason, and what the judge reads in the passages behind each level. It never changes a label.'}
        </p>
        {review.error && (
          <p role="alert" className="text-sm text-refutes">
            {review.error}
          </p>
        )}
        <ul aria-live="polite" className="flex flex-col gap-2">
          {review.findings.map((finding, index) => {
            const tone = TONES[finding.tone]
            return (
              <li
                key={index}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm transition-colors',
                  index === review.step ? 'border-accent bg-accent-soft' : 'border-border-subtle',
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                  <tone.icon className={cn('size-3.5', tone.text)} aria-hidden="true" />
                  <span className={tone.text}>{tone.label}</span> · {targetName(finding, claim, references)}
                </p>
                <p className="text-ink">{finding.text}</p>
                <button
                  type="button"
                  onClick={() => review.show(index)}
                  className="min-h-8 self-start rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Show me
                </button>
              </li>
            )
          })}
        </ul>
        {review.status === 'done' && review.findings.length === 0 && <p className="text-sm text-ink-muted">Nothing to point out.</p>}
      </section>
      <Question analysisId={analysisId} references={cited} />
    </div>
  )
}

/** A review run: its findings, and which one the cursor is on, told to `onPoint` (keep it
 * stable: it is an effect dependency). The cursor waits DWELL_MS on each finding, then moves on;
 * once the person picks a finding with Show me, it stays where they put it. */
function useReview(analysisId: string, claimId: string, onPoint: (pointing: Pointing | null) => void) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [status, setStatus] = useState<'idle' | 'reviewing' | 'done' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(-1)
  const [following, setFollowing] = useState(true) // false once the person picks a finding
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  // The cursor walks the findings in order as they arrive, then stays on the last one.
  useEffect(() => {
    if (!following || step >= findings.length - 1) return
    // The first finding is shown at once; each later one after the cursor's stay on the last.
    const timer = window.setTimeout(() => setStep((s) => s + 1), step < 0 ? 0 : DWELL_MS)
    return () => window.clearTimeout(timer)
  }, [following, step, findings.length])

  useEffect(() => {
    if (step >= 0 && findings[step]) onPoint({ target: findings[step].target, tone: findings[step].tone })
    else if (status === 'reviewing') onPoint({ target: { kind: 'claim', id: claimId }, tone: 'reading' })
  }, [step, findings, status, claimId, onPoint])

  function start() {
    controller.current?.abort()
    controller.current = new AbortController()
    setFindings([])
    setStep(-1)
    setFollowing(true)
    setError(null)
    setStatus('reviewing')
    const onEvent = (event: ReviewEvent) => {
      if (event.type === 'finding') setFindings((all) => [...all, event])
      else if (event.type === 'error') setError(event.message)
    }
    reviewClaim(analysisId, claimId, onEvent, controller.current.signal)
      .then(() => setStatus('done'))
      .catch((reason: unknown) => {
        if ((reason as Error).name === 'AbortError') return
        const { title, hint } = problem(reason)
        setError(`${title}. ${hint}`)
        setStatus('failed')
      })
  }

  function show(index: number) {
    setFollowing(false)
    setStep(index)
  }

  return { findings, status, error, step, start, show }
}

function Question({ analysisId, references }: { analysisId: string; references: Reference[] }) {
  const [about, setAbout] = useState('')
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  function ask(event: React.FormEvent) {
    event.preventDefault()
    const question = text.trim()
    if (!question) return
    controller.current?.abort()
    controller.current = new AbortController()
    setAnswer({ question, statements: [], status: 'answering' })
    const update = (change: (a: Answer) => Answer) => setAnswer((a) => (a ? change(a) : a))
    askLabeling(
      analysisId,
      question,
      about,
      (event) => {
        if (event.type === 'statement') update((a) => ({ ...a, statements: [...a.statements, event] }))
        else if (event.type === 'verdict')
          update((a) => ({ ...a, statements: a.statements.map((s) => (s.index === event.index ? { ...s, ...event } : s)) }))
        else if (event.type === 'error') update((a) => ({ ...a, status: 'failed', error: event.message }))
      },
      controller.current.signal,
    )
      .then(() => update((a) => (a.status === 'answering' ? { ...a, status: 'done' } : a)))
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') update((a) => ({ ...a, status: 'failed', error: problem(reason).title }))
      })
  }

  return (
    <section aria-labelledby="ask-question-title" className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <h3 id="ask-question-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Mascot role="labeler" size={28} />
        Ask a question
      </h3>
      <form onSubmit={ask} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          About
          <select value={about} onChange={(e) => setAbout(e.target.value)} className="min-h-9 rounded-lg border border-border-subtle bg-surface px-2 text-sm text-ink">
            <option value="">The paper under review</option>
            {references.map((r) => (
              <option key={r.reference_id} value={r.reference_id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-muted">
            Question
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              placeholder="e.g. Which dataset does it report recall on?"
              className="min-h-9 rounded-lg border border-border-subtle bg-surface px-2 text-sm text-ink placeholder:text-ink-muted"
            />
          </label>
          <Button type="submit" disabled={!text.trim() || answer?.status === 'answering'} className="min-h-9">
            <Sparkles className="size-4" aria-hidden="true" />
            Ask
          </Button>
        </div>
      </form>
      {answer && (
        <div aria-live="polite" className="flex flex-col gap-2 text-sm">
          <p className="text-xs text-ink-muted">{answer.question}</p>
          {answer.status === 'answering' && answer.statements.length === 0 && (
            <p className="flex items-center gap-1.5 text-ink-muted">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Reading the paper…
            </p>
          )}
          {answer.statements.map((statement) => (
            <p key={statement.index} className="text-ink">
              {statement.text}{' '}
              <span className="text-xs whitespace-nowrap text-ink-muted">
                · {statement.verdict ? VERDICTS[statement.verdict] : 'Checking…'}
                {statement.page ? ` · p.${statement.page}` : ''}
              </span>
            </p>
          ))}
          {answer.status === 'done' && answer.statements.length === 0 && <p className="text-ink-muted">No passage in it answers that.</p>}
          {answer.status === 'failed' && (
            <p role="alert" className="text-refutes">
              Could not answer: {answer.error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** What a finding is about, in words: the claim, a reference's title, or a passage by rank. */
function targetName(finding: Finding, claim: WorkClaim, references: Reference[]) {
  const { kind, id } = finding.target
  if (kind === 'claim') return 'The claim'
  if (kind === 'reference') return references.find((r) => r.reference_id === id)?.label ?? id
  const candidate = claim.candidates.find((c) => c.cand_id === id)
  const reference = references.find((r) => r.reference_id === candidate?.reference_id)
  return candidate ? `Passage ${candidate.rank} of ${reference?.label ?? candidate.reference_id}` : 'A passage'
}

