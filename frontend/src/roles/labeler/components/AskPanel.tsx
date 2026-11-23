/**
 * Ask AI in the labeler, for the claim on screen: a review of what the person saved, and
 * questions about the paper, one of the references it cites, or one retrieved passage read with
 * the claim. The review points things out and never changes a label (docs/labeling.md). The workspace keys this panel by claim, so moving to
 * another claim starts it afresh and stops a review still running.
 */

import { Check, CircleAlert, CircleHelp, Loader2, Sparkles, Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType } from 'react'

import { AskInput } from '../../../components/AskInput'
import { CommandResult } from '../../../components/CommandResult'
import { Mascot } from '../../../components/Mascot'
import { Badge, Button } from '../../../components/ui'
import type { Statement, StatementVerdict } from '../../../lib/assistant'
import { request } from '../../../lib/api'
import { describeResult, parseCommand, type CommandView } from '../../../lib/askCommands'
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

type Verdict = {
  label: string
  tone: 'supports' | 'insufficient' | 'refutes' | 'neutral'
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
}

// The same words and colours as the researcher's Ask stamps, with an icon so colour is not the only cue.
const VERDICTS: Record<StatementVerdict | 'checking', Verdict> = {
  supports: { label: 'Backed', tone: 'supports', icon: Check },
  insufficient: { label: 'Silent', tone: 'insufficient', icon: CircleAlert },
  refutes: { label: 'Contradicted', tone: 'refutes', icon: X },
  unchecked: { label: 'Not checked', tone: 'neutral', icon: CircleHelp },
  error: { label: 'Not checked', tone: 'neutral', icon: CircleHelp },
  checking: { label: 'Checking…', tone: 'neutral', icon: Loader2 },
}

/** A passage the labeler chose to ask about (PassageList's Ask button). `name` is how the chip
 * reads, such as "#1 OpenAI o1 System Card". */
export type AskedPassage = { referenceId: string; name: string; page: number | null; text: string }

type Answer = { question: string; statements: Statement[]; status: 'answering' | 'done' | 'failed'; error?: string; note?: string; view?: CommandView; command?: string }

export function AskPanel({
  analysisId,
  claim,
  wording,
  references,
  reviewBlocked,
  onPoint,
  passage,
  askId,
  onClearPassage,
}: {
  analysisId: string
  claim: WorkClaim
  /** The claim as worded on screen: the labeler's edit, if they reworded it. */
  wording: string
  references: Reference[]
  /** Why the review cannot run yet (nothing saved, or unsaved changes), or null. */
  reviewBlocked: string | null
  onPoint: (pointing: Pointing | null) => void
  passage: AskedPassage | null
  /** Changes with each Ask about a passage, which starts a fresh question focused for it. */
  askId: number
  onClearPassage: () => void
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
      <Question
        key={askId}
        analysisId={analysisId}
        references={cited}
        passage={passage}
        wording={wording}
        onClearPassage={onClearPassage}
      />
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

function Question({
  analysisId,
  references,
  passage,
  wording,
  onClearPassage,
}: {
  analysisId: string
  references: Reference[]
  passage: AskedPassage | null
  wording: string
  onClearPassage: () => void
}) {
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
    if (question.startsWith('/')) {
      void runCommand(question, controller.current.signal)
      return
    }
    // The answer is never null once a question is asked; the check only satisfies the type of setAnswer.
    /* v8 ignore next -- @preserve */
    const update = (change: (a: Answer) => Answer) => setAnswer((a) => (a ? change(a) : a))
    askLabeling(
      analysisId,
      question,
      passage ? { reference_id: passage.referenceId, passage: passage.text, claim: wording } : { reference_id: about },
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

  /** A /command (lib/askCommands) on the open paper: its tool's result, not an answer from the paper. */
  async function runCommand(question: string, signal: AbortSignal) {
    const parsed = parseCommand(question, [], analysisId)
    if ('error' in parsed) {
      setAnswer({ question, statements: [], status: 'failed', error: parsed.error })
      return
    }
    try {
      const result = await request<Record<string, unknown>>(`/agent/tools/${parsed.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.args),
        signal,
      })
      setAnswer({ question, statements: [], status: 'done', command: `/${parsed.name}`, ...describeResult(parsed.name, result, parsed.args) })
    } catch (reason) {
      if ((reason as Error).name !== 'AbortError') setAnswer({ question, statements: [], status: 'failed', error: problem(reason).title })
    }
  }

  return (
    <section aria-labelledby="ask-question-title" className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <h3 id="ask-question-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Mascot role="labeler" size={28} />
        Ask a question
      </h3>
      <form onSubmit={ask} className="flex flex-col gap-2">
        {passage ? (
          <PassageChip passage={passage} onClear={onClearPassage} />
        ) : (
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
        )}
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-muted">
            Question
            <AskInput
              draft={text}
              onChange={setText}
              papers={[]}
              disabled={false}
              label="Question"
              placeholder={passage ? 'e.g. Does this passage back the claim?' : 'e.g. Which dataset does it report recall on? Or / for commands'}
              autoFocus={passage !== null}
              className="min-h-9 w-full rounded-lg border border-border-subtle bg-surface px-2 text-sm text-ink placeholder:text-ink-muted"
              menuClassName="absolute bottom-full left-0 z-20 mb-1 w-full"
            />
          </label>
          <Button type="submit" disabled={!text.trim() || answer?.status === 'answering'} className="min-h-9">
            <Sparkles className="size-4" aria-hidden="true" />
            Ask
          </Button>
        </div>
      </form>
      {answer && <AnswerView answer={answer} reading={passage ? 'Reading the passage…' : 'Reading the paper…'} />}
    </section>
  )
}

/** The passage a question is about, with the claim it is read with; × goes back to asking a whole paper. */
function PassageChip({ passage, onClear }: { passage: AskedPassage; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
      About
      <div className="flex min-h-9 items-center gap-2 rounded-lg border border-accent bg-accent-soft pl-2 text-sm text-ink">
        <span className="min-w-0 flex-1 truncate" title={passage.text}>
          {passage.name}
          {passage.page != null && ` · p.${passage.page}`}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Stop asking about this passage"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="font-normal">The answer reads only this passage, with the claim as worded on screen.</p>
    </div>
  )
}

/** A question and its answer: what was asked, a count of the checks, and each statement with a
 * badge for what the judge found in the passage it cites. */
function AnswerView({ answer, reading }: { answer: Answer; reading: string }) {
  const { statements } = answer
  const answering = answer.status === 'answering'
  return (
    <div aria-live="polite" className="flex flex-col gap-3 text-sm">
      <div className="rounded-lg bg-neutral-soft px-3 py-2">
        <p className="type-label text-ink-muted">You asked</p>
        <p className="text-ink">{answer.question}</p>
      </div>
      {statements.length > 0 && <p className="text-xs font-medium text-ink-muted">{answerSummary(statements, answering)}</p>}
      {answering && statements.length === 0 && (
        <p className="flex items-center gap-1.5 text-ink-muted">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {reading}
        </p>
      )}
      {statements.length > 0 && (
        <ol className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {statements.map((statement) => (
            <AnswerStatement key={statement.index} statement={statement} answering={answering} />
          ))}
        </ol>
      )}
      {/* A view always comes with its command; the fallback only satisfies the type. */}
      {/* v8 ignore start -- @preserve */}
      {answer.view && <CommandResult view={answer.view} command={answer.command ?? 'command'} />}
      {/* v8 ignore stop -- @preserve */}
      {answer.note && <p className="text-xs leading-5 text-ink-muted">{answer.note}</p>}
      {answer.status === 'done' && statements.length === 0 && !answer.note && !answer.view && <p className="text-ink-muted">No passage in it answers that.</p>}
      {answer.status === 'failed' && (
        <p role="alert" className="text-refutes">
          Could not answer: {answer.error}
        </p>
      )}
    </div>
  )
}

/** One statement: the sentence, its verdict badge and page, and, once checked, what the passage says. */
function AnswerStatement({ statement, answering }: { statement: Statement; answering: boolean }) {
  // A statement left without a verdict when the answer ended (stopped or failed) was never checked.
  const state = statement.verdict ?? (answering ? 'checking' : 'unchecked')
  const verdict = VERDICTS[state]
  const why = statement.quote || statement.reasoning
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <p className="text-ink">{statement.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verdict.tone}>
          <verdict.icon className={cn(state === 'checking' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
          {verdict.label}
        </Badge>
        {statement.page && <span className="text-xs text-ink-muted tabular-nums">Page {statement.page}</span>}
      </div>
      {why && (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer font-medium text-accent">What the passage says</summary>
          <div className="mt-1.5 flex flex-col gap-1 rounded-lg bg-neutral-soft p-2.5">
            {statement.quote && <p className="font-serif text-sm italic text-ink">“{statement.quote}”</p>}
            {statement.reasoning && <p className="text-ink-muted">{statement.reasoning}</p>}
          </div>
        </details>
      )}
    </li>
  )
}

/** "6 of 6 backed", "4 of 6 backed · 1 contradicted", or "Checking 3 of 6" while checks come in. */
function answerSummary(statements: Statement[], answering: boolean) {
  const checked = statements.filter((s) => s.verdict).length
  if (answering && checked < statements.length) return `Checking ${checked + 1} of ${statements.length}`
  const backed = statements.filter((s) => s.verdict === 'supports').length
  const contradicted = statements.filter((s) => s.verdict === 'refutes').length
  return [`${backed} of ${statements.length} backed`, contradicted > 0 && `${contradicted} contradicted`].filter(Boolean).join(' · ')
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

