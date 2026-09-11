/**
 * Teacher reading questions — a generated worksheet and its answer key for one paper.
 *
 * The screen owns only view state (generation options, edit mode, and the paper viewer).
 * Records and mutations come through the teacher hooks so the mock can later be replaced by
 * the gateway without moving data or request logic into this component.
 */

import { Copy, Download, FileText, Loader2, Pen, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { PageViewer, type Target } from '../../../components/PageViewer'
import { Button, Card, Empty, Input } from '../../../components/ui'
import { api } from '../../../lib/api'
import {
  type ReadingQuestionLevel,
  type ReadingQuestionType,
  type TeacherReadingQuestion,
  type UpdateReadingQuestionInput,
} from '../../../lib/teacher'
import {
  useDeleteReadingQuestion,
  useRegenerateReadingQuestions,
  useTeacherReadingQuestions,
  useUpdateReadingQuestion,
} from '../../../lib/useTeacher'
import { cn } from '../../../lib/utils'

const LEVEL_OPTIONS: { value: ReadingQuestionLevel; label: string }[] = [
  { value: 'undergrad', label: 'Undergrad' },
  { value: 'graduate', label: 'Graduate' },
]

const TYPE_OPTIONS: { value: ReadingQuestionType; label: string }[] = [
  { value: 'comprehension', label: 'Comprehension' },
  { value: 'critique', label: 'Critique' },
  { value: 'discussion', label: 'Discussion' },
]

const TYPE_LABELS: Record<ReadingQuestionType, string> = {
  comprehension: 'Comprehension',
  critique: 'Critique',
  discussion: 'Discussion',
}

const TYPE_STYLES: Record<ReadingQuestionType, string> = {
  comprehension: 'bg-supports-soft text-supports',
  critique: 'bg-refutes-soft text-refutes',
  discussion: 'bg-insufficient-soft text-insufficient',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-xs font-medium text-ink',
        active ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface',
      )}
    >
      {label}
    </Button>
  )
}

/** These are question categories, not citation verdicts, so they stay separate from shared badges. */
function QuestionTypeBadge({ type }: { type: ReadingQuestionType }) {
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', TYPE_STYLES[type])}>
      {TYPE_LABELS[type]}
    </span>
  )
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

/** Export stays in the browser until the future teacher gateway owns worksheet exports. */
function downloadWorksheet(
  paperTitle: string,
  questions: TeacherReadingQuestion[],
) {
  const rows = [
    ['Number', 'Level', 'Type', 'Anchor', 'Question', 'Passage', 'Answer'],
    ...questions.map((question, index) => [
      String(index + 1),
      question.level,
      TYPE_LABELS[question.type],
      question.anchor,
      question.prompt,
      question.excerpt ?? '',
      question.answer ?? '',
    ]),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `${paperTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'reading-questions'}-worksheet.csv`,
  })
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function answerKeyText(questions: TeacherReadingQuestion[]) {
  return questions
    .map((question, index) => (question.answer ? `Q${index + 1} ${question.answer}` : null))
    .filter((answer): answer is string => answer !== null)
    .join('\n')
}

function AnswerKey({ questions }: { questions: TeacherReadingQuestion[] }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const answers = questions
    .map((question, index) => ({ question, number: index + 1 }))
    .filter(({ question }) => question.answer)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerKeyText(questions))
      setCopyError(null)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError('Could not copy the answer key.')
    }
  }

  return (
    <Card className="h-fit">
      <h2 className="font-serif text-lg font-semibold text-ink">Answer key</h2>
      <p className="mt-3 text-[13px] leading-5 text-ink-muted">
        Each answer is the paper&apos;s own passage, so grading is a page check, not a judgment call.
      </p>

      {answers.length === 0 ? (
        <div className="mt-4">
          <Empty title="No answers yet" hint="Generated answers will appear here." />
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {answers.map(({ question, number }) => (
            <li key={question.id} className="flex items-start gap-2 text-[13px] leading-5 text-ink-muted">
              <span className="shrink-0 font-medium text-accent">Q{number}</span>
              <span>{question.answer}</span>
            </li>
          ))}
        </ol>
      )}

      <Button
        type="button"
        variant="ghost"
        onClick={() => void copy()}
        disabled={answers.length === 0}
        className="mt-4 rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
      >
        <Copy className="size-4" />
        {copied ? 'Copied' : 'Copy answer key'}
      </Button>
      {copyError && (
        <p role="alert" className="mt-2 text-xs text-refutes">
          {copyError}
        </p>
      )}
    </Card>
  )
}

function QuestionCard({
  number,
  question,
  onDelete,
  onShowInPaper,
  onSave,
  deleting,
  saving,
  finding,
}: {
  number: number
  question: TeacherReadingQuestion
  onDelete: (question: TeacherReadingQuestion) => Promise<void>
  onShowInPaper: (question: TeacherReadingQuestion) => Promise<void>
  onSave: (input: UpdateReadingQuestionInput) => Promise<void>
  deleting: boolean
  saving: boolean
  finding: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [prompt, setPrompt] = useState(question.prompt)
  const [answer, setAnswer] = useState(question.answer ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  const beginEdit = () => {
    setPrompt(question.prompt)
    setAnswer(question.answer ?? '')
    setFormError(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setFormError(null)
    setEditing(false)
  }

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextPrompt = prompt.trim()
    if (!nextPrompt) {
      setFormError('A question cannot be empty.')
      return
    }

    setFormError(null)
    try {
      await onSave({ id: question.id, prompt: nextPrompt, answer: answer.trim() })
      setEditing(false)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const remove = async () => {
    if (!window.confirm(`Remove question ${number}? This cannot be undone.`)) return

    try {
      await onDelete(question)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <article aria-label={`Reading question ${number}`}>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums text-ink-muted">{number}</span>
          <QuestionTypeBadge type={question.type} />
          <span className="text-xs text-accent">anchored to {question.anchor}</span>
        </div>

        {editing ? (
          <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void submitEdit(event)}>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-muted" htmlFor={`prompt-${question.id}`}>
              Question
              <Input
                id={`prompt-${question.id}`}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-muted" htmlFor={`answer-${question.id}`}>
              Answer key entry
              <textarea
                id={`answer-${question.id}`}
                rows={3}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="w-full resize-y rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm font-normal text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            {formError && (
              <p role="alert" className="text-xs text-refutes">
                {formError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h2 id={`reading-question-${question.id}`} className="mt-3 text-sm leading-5 text-ink">
              {question.prompt}
            </h2>
            {question.excerpt && (
              <p className="mt-3 border-l-2 border-border-subtle pl-3 font-serif text-[13px] italic leading-5 text-ink-muted">
                “{question.excerpt}”
              </p>
            )}

            {formError && (
              <p role="alert" className="mt-3 text-xs text-refutes">
                {formError}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-border-subtle pt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={beginEdit}
                className="rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
              >
                <Pen className="size-4" />
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onShowInPaper(question)}
                disabled={finding}
                className="rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
              >
                {finding ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                {finding ? 'Finding passage...' : 'Show in the paper'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void remove()}
                disabled={deleting}
                className="rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Remove
              </Button>
            </div>
          </>
        )}
      </Card>
    </article>
  )
}

export function ReadingQuestions() {
  const page = useTeacherReadingQuestions()
  const regenerate = useRegenerateReadingQuestions()
  const update = useUpdateReadingQuestion()
  const remove = useDeleteReadingQuestion()
  const [level, setLevel] = useState<ReadingQuestionLevel>('undergrad')
  // Derive the initial chips from the loaded worksheet so every generated type is visible.
  const [selectedTypes, setSelectedTypes] = useState<ReadingQuestionType[] | null>(null)
  const [paperTarget, setPaperTarget] = useState<Target | null>(null)
  const [findingQuestionId, setFindingQuestionId] = useState<string | null>(null)

  if (page.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading reading questions...
      </p>
    )
  }

  if (page.isError) {
    return (
      <Card className="border-refutes text-refutes">
        <p role="alert">Could not load reading questions: {errorMessage(page.error)}</p>
        <Button type="button" variant="ghost" onClick={() => void page.refetch()} className="mt-3 px-0 text-refutes">
          Try again
        </Button>
      </Card>
    )
  }

  if (!page.data) return null

  const loadedTypes = Array.from(new Set(page.data.questions.map((question) => question.type)))
  const activeTypes = selectedTypes ?? loadedTypes
  const shownQuestions = page.data.questions.filter(
    (question) => question.level === level && activeTypes.includes(question.type),
  )

  const toggleType = (type: ReadingQuestionType) => {
    setSelectedTypes((current) => {
      const types = current ?? activeTypes
      return types.includes(type) ? types.filter((selected) => selected !== type) : [...types, type]
    })
  }

  const regenerateQuestions = () => {
    if (activeTypes.length === 0) return
    // The current question set is about to be replaced, so do not leave a stale target open.
    setPaperTarget(null)
    regenerate.mutate({ paperId: page.data.paper.id, paperTitle: page.data.paper.title, level, types: activeTypes })
  }

  const saveQuestion = (input: UpdateReadingQuestionInput) => update.mutateAsync(input).then(() => undefined)

  const deleteQuestion = async (question: TeacherReadingQuestion) => {
    setPaperTarget(null)
    await remove.mutateAsync(question.id)
  }

  /** Search for a highlight through the existing gateway, then always open the shared viewer. */
  const showInPaper = async (question: TeacherReadingQuestion) => {
    setFindingQuestionId(question.id)
    const found = question.excerpt
      ? await api.findInPaper(page.data.paper.fileName, question.excerpt, question.page).catch(() => null)
      : null

    setPaperTarget({
      paper: page.data.paper.fileName,
      label: `Question ${shownQuestions.indexOf(question) + 1} · ${page.data.paper.title}`,
      quote: question.excerpt ?? undefined,
      source: found && found.page !== null ? (found as Target['source']) : null,
      page: question.page,
    })
    setFindingQuestionId(null)
  }

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Reading questions</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {page.data.paper.title} ({page.data.paper.citation}) · built from {page.data.paper.verifiedClaims} verified claims
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={regenerateQuestions}
            disabled={regenerate.isPending || activeTypes.length === 0}
          >
            {regenerate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {regenerate.isPending ? 'Regenerating...' : 'Regenerate'}
          </Button>
          <Button
            type="button"
            onClick={() => downloadWorksheet(page.data.paper.title, shownQuestions)}
            disabled={shownQuestions.length === 0}
          >
            <Download className="size-4" />
            Export worksheet
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-ink-muted">Level</span>
        {LEVEL_OPTIONS.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            active={level === option.value}
            onClick={() => setLevel(option.value)}
          />
        ))}
        <span className="ml-1 mr-1 text-xs text-ink-muted">Type</span>
        {TYPE_OPTIONS.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            active={activeTypes.includes(option.value)}
            onClick={() => toggleType(option.value)}
          />
        ))}
      </div>

      {/* The same choices filter the current worksheet and configure the next generation. */}

      {activeTypes.length === 0 && (
        <p role="status" className="text-xs text-ink-muted">
          Select at least one question type before regenerating.
        </p>
      )}

      {regenerate.isError && (
        <Card className="border-refutes text-refutes">
          Could not regenerate questions: {errorMessage(regenerate.error)}
        </Card>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.8fr)_minmax(20rem,1fr)] lg:items-start">
        <section aria-labelledby="question-list-heading" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="question-list-heading" className="text-sm font-semibold text-ink">
              {shownQuestions.length} {shownQuestions.length === 1 ? 'question' : 'questions'}
            </h2>
          </div>

          {page.data.questions.length === 0 ? (
            <Empty title="No reading questions yet" hint="Regenerate the worksheet to create questions from this paper." />
          ) : shownQuestions.length === 0 ? (
            <Empty title="No questions match these filters" hint="Choose another level or question type." />
          ) : (
            <div className="flex flex-col gap-3">
              {shownQuestions.map((question, index) => (
                <QuestionCard
                  key={question.id}
                  number={index + 1}
                  question={question}
                  onSave={saveQuestion}
                  onDelete={deleteQuestion}
                  onShowInPaper={showInPaper}
                  saving={update.isPending && update.variables?.id === question.id}
                  deleting={remove.isPending && remove.variables === question.id}
                  finding={findingQuestionId === question.id}
                />
              ))}
            </div>
          )}
        </section>

        {paperTarget ? (
          <PageViewer target={paperTarget} onClose={() => setPaperTarget(null)} />
        ) : (
          <AnswerKey questions={shownQuestions} />
        )}
      </div>
    </>
  )
}
