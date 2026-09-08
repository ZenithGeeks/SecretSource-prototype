/**
 * 13 Essay check (Teacher) — inspect a student's citations and prepare feedback.
 *
 * This screen intentionally composes existing primitives (`Card`, `Button`, and
 * `StandingBadge`). There is no shared citation-review or feedback-dialog component in the
 * component guide, so those two pieces stay local to this role page until another role needs
 * the same interaction.
 */

import { Check, ChevronLeft, ChevronRight, Copy, FileText, Loader2, Pencil } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button, Card, StandingBadge } from '../../../components/ui'
import type { EssayCheck as EssayCheckData, EssayReview, StudentNavigation } from '../../../lib/teacher'
import { useSendTeacherFeedback, useTeacherEssayCheck } from '../../../lib/useTeacher'
import { cn } from '../../../lib/utils'

const DEFAULT_STUDENT_ID = 'student-anan'

function feedbackPreview(body: string, citedPages: string[]) {
  const firstParagraph = body.split(/\n\s*\n/)[0]?.trim() || body.trim()
  return `“${firstParagraph}” — cites ${citedPages.join(', ')}`
}

function CitationReviewCard({
  review,
  isShowingInPaper,
  isAddedToFeedback,
  onShowInPaper,
  onAddToFeedback,
}: {
  review: EssayReview
  isShowingInPaper: boolean
  isAddedToFeedback: boolean
  onShowInPaper: () => void
  onAddToFeedback: () => void
}) {
  return (
    <Card
      className={cn(
        'flex flex-col gap-0 p-4 transition-colors',
        isShowingInPaper && 'border-accent',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StandingBadge standing={review.standing} />
        <span className="text-xs text-ink-muted">{review.citation}</span>
      </div>

      <blockquote className="mt-3 font-serif text-[15px] italic leading-5 text-ink">
        “{review.claim}”
      </blockquote>

      <div className="mt-3 border-l-2 border-accent pl-3 text-sm leading-5 text-ink-muted">
        <p>
          {review.sourceQuote} <span className="whitespace-nowrap">— {review.sourceLocation}</span>
        </p>
      </div>

      {review.explanation && <p className="mt-2 text-sm leading-5 text-ink-muted">{review.explanation}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onShowInPaper}
          aria-pressed={isShowingInPaper}
          className="rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
        >
          {isShowingInPaper ? <Check className="size-4" /> : <FileText className="size-4" />}
          {isShowingInPaper ? 'Shown in the paper' : 'Show in the paper'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onAddToFeedback}
          aria-pressed={isAddedToFeedback}
          className="rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
        >
          {isAddedToFeedback ? <Check className="size-4" /> : <Pencil className="size-4" />}
          {isAddedToFeedback ? 'Added to feedback' : 'Add to feedback'}
        </Button>
      </div>
    </Card>
  )
}

function StudentStepper({
  previous,
  next,
  onNavigate,
}: {
  previous?: StudentNavigation
  next?: StudentNavigation
  onNavigate: (student: StudentNavigation) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-5 lg:pt-[18px]">
      <Button
        type="button"
        variant="ghost"
        disabled={!previous}
        onClick={() => previous && onNavigate(previous)}
        className="rounded-md px-3 py-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
      >
        <ChevronLeft className="size-4" />
        Previous
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={!next}
        onClick={() => next && onNavigate(next)}
        className="rounded-md px-3 py-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
      >
        <ChevronRight className="size-4" />
        Next student
      </Button>
    </div>
  )
}

function FeedbackPanel({
  essay,
  body,
  isSent,
  isSending,
  sendError,
  onBodyChange,
  onCopy,
  onSend,
  copied,
}: {
  essay: EssayCheckData
  body: string
  isSent: boolean
  isSending: boolean
  sendError: Error | null
  onBodyChange: (body: string) => void
  onCopy: () => void
  onSend: () => void
  copied: boolean
}) {
  return (
    <Card className="flex flex-col gap-0 p-5 lg:sticky lg:top-6">
      <h2 className="font-serif text-lg font-semibold leading-5 tracking-tight text-ink">
        Feedback to {essay.student.name}
      </h2>

      <p className="mt-4 text-xs text-ink-muted">
        Citation accuracy{' '}
        <span className="ml-1 font-semibold text-refutes">
          {essay.citationSummary.contradicted} / {essay.citationSummary.total}
        </span>
      </p>

      <label className="sr-only" htmlFor="teacher-feedback">
        Feedback to {essay.student.name}
      </label>
      <textarea
        id="teacher-feedback"
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        className="mt-3 min-h-[251px] w-full resize-y rounded-lg border border-border-subtle bg-canvas p-3 text-[13px] leading-5 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
        aria-describedby="teacher-feedback-note"
      />

      <p id="teacher-feedback-note" className="mt-3 text-xs text-ink-muted">
        Drafted from the verdicts above. Edit before sending.
      </p>

      {sendError && (
        <p className="mt-2 text-xs text-refutes" role="alert">
          Could not send feedback: {sendError.message}
        </p>
      )}

      {isSent && (
        <p className="mt-2 text-xs text-supports" role="status">
          Feedback sent to {essay.student.name}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-5">
        <Button type="button" onClick={onSend} disabled={isSent || isSending || !body.trim()}>
          {isSending && <Loader2 className="size-4 animate-spin" />}
          {isSent ? 'Sent to student' : 'Send to student'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCopy}
          disabled={!body.trim()}
          className="rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Card>
  )
}

function SendConfirmation({
  studentName,
  preview,
  isSending,
  onKeepEditing,
  onSend,
}: {
  studentName: string
  preview: string
  isSending: boolean
  onKeepEditing: () => void
  onSend: () => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getFocusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('aria-hidden'),
      )

    const focusableElements = getFocusableElements()
    ;(focusableElements[0] ?? dialog).focus()

    const keepFocusInsideDialog = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const currentFocusableElements = getFocusableElements()
      if (currentFocusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const firstElement = currentFocusableElements[0]
      const lastElement = currentFocusableElements[currentFocusableElements.length - 1]
      const focusIsOutsideDialog = !dialog.contains(document.activeElement)

      if (focusIsOutsideDialog || (event.shiftKey && document.activeElement === firstElement)) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInsideDialog)
    return () => {
      document.removeEventListener('keydown', keepFocusInsideDialog)
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onKeepEditing()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-[440px] rounded-2xl bg-surface p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="font-serif text-lg font-semibold tracking-tight text-ink">
          Send feedback to {studentName}?
        </h2>
        <p className="mt-3 text-sm leading-5 text-ink-muted">
          They get the text below and links to the three pages it cites.
          <br />
          You can edit it later; they will see the edit.
        </p>

        <p className="mt-3 rounded-lg bg-canvas px-3 py-3 text-xs leading-4 text-ink">{preview}</p>

        <div className="mt-3 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onKeepEditing}
            className="rounded-md px-2 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
          >
            Keep editing
          </Button>
          <Button
            type="button"
            onClick={onSend}
            disabled={isSending}
            className="bg-ink text-white hover:opacity-90"
          >
            {isSending && <Loader2 className="size-4 animate-spin" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function EssayCheckContent({
  data,
  onNavigate,
}: {
  data: EssayCheckData
  onNavigate: (student: StudentNavigation) => void
}) {
  const sendFeedback = useSendTeacherFeedback()
  const [feedbackBody, setFeedbackBody] = useState(data.feedback.body)
  const [addedReviewIds, setAddedReviewIds] = useState<string[]>([])
  const [shownReviewId, setShownReviewId] = useState<string | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isSent, setIsSent] = useState(false)

  // Escape is the least surprising way to leave the confirmation state for keyboard users.
  useEffect(() => {
    if (!isConfirmOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsConfirmOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isConfirmOpen])

  const sendError = sendFeedback.error as Error | null
  const preview =
    feedbackBody === data.feedback.body
      ? data.feedback.preview
      : feedbackPreview(feedbackBody, data.feedback.citedPages)

  const showInPaper = (review: EssayReview) => setShownReviewId(review.id)

  const addToFeedback = (review: EssayReview) => {
    setAddedReviewIds((current) => {
      if (current.includes(review.id)) return current
      return [...current, review.id]
    })

    // The initial draft already contains the three problematic citations. For an additional
    // card, append a compact note to the editable draft so this action has a visible result.
    if (!feedbackBody.includes(review.citation)) {
      const note = `${review.citation}: ${review.explanation ?? `${review.sourceQuote} — ${review.sourceLocation}`}`
      setFeedbackBody((current) => `${current.trim()}\n\n${note}`)
    }
  }

  const navigateToStudent = (student: StudentNavigation) => {
    onNavigate(student)
  }

  const openConfirmation = () => {
    if (feedbackBody.trim()) setIsConfirmOpen(true)
  }

  const send = () => {
    sendFeedback.mutate(
      {
        studentId: data.student.id,
        body: feedbackBody,
        citationIds: [...new Set([...data.feedback.citationIds, ...addedReviewIds])],
      },
      {
        onSuccess: () => {
          setIsConfirmOpen(false)
          setIsSent(true)
        },
      },
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedbackBody)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access is optional; leaving the editable text in place is still usable.
      setCopied(false)
    }
  }

  return (
    <>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1 text-xs text-accent">
            <span>{data.assignment.course}</span>
            <ChevronRight className="size-3 text-ink-muted" />
            <span>{data.assignment.name}</span>
            <ChevronRight className="size-3 text-ink-muted" />
            <span className="text-ink-muted">{data.student.name}</span>
          </p>
          <h1 className="mt-1 font-serif text-[22px] font-semibold tracking-tight text-ink">
            {data.student.name} — {data.student.fileName}
          </h1>
          <p className="text-sm text-ink-muted">
            {data.citationSummary.total} citations · {data.citationSummary.contradicted} contradicted ·{' '}
            {data.citationSummary.silent} silent · {data.citationSummary.backed} backed
          </p>
        </div>

        <StudentStepper
          previous={data.navigation.previous}
          next={data.navigation.next}
          onNavigate={navigateToStudent}
        />
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,4fr)]">
        <section aria-label="Citation reviews" className="flex min-w-0 flex-col gap-3">
          {data.reviews.map((review) => (
            <CitationReviewCard
              key={review.id}
              review={review}
              isShowingInPaper={shownReviewId === review.id}
              isAddedToFeedback={addedReviewIds.includes(review.id)}
              onShowInPaper={() => showInPaper(review)}
              onAddToFeedback={() => addToFeedback(review)}
            />
          ))}
        </section>

        <FeedbackPanel
          essay={data}
          body={feedbackBody}
          isSent={isSent}
          isSending={sendFeedback.isPending}
          sendError={sendError}
          onBodyChange={(body) => {
            setFeedbackBody(body)
            setIsSent(false)
          }}
          onCopy={copy}
          onSend={openConfirmation}
          copied={copied}
        />
      </div>

      {isConfirmOpen && (
        <SendConfirmation
          studentName={data.student.name}
          preview={preview}
          isSending={sendFeedback.isPending}
          onKeepEditing={() => setIsConfirmOpen(false)}
          onSend={send}
        />
      )}
    </>
  )
}

export function EssayCheck() {
  const [studentId, setStudentId] = useState(DEFAULT_STUDENT_ID)
  const essay = useTeacherEssayCheck(studentId)

  if (essay.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading essay check…
      </p>
    )
  }

  if (essay.isError) {
    return (
      <Card className="border-refutes text-refutes">
        Could not load this essay: {(essay.error as Error).message}
      </Card>
    )
  }

  if (!essay.data) return null

  // A new key gives each student an isolated editable draft and confirmation state.
  return (
    <EssayCheckContent
      key={essay.data.student.id}
      data={essay.data}
      onNavigate={(student) => setStudentId(student.id)}
    />
  )
}
