import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, FileText, MessageSquarePlus, Send } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import { feedbackPreview, toggleFeedbackReview } from '../../../lib/teacherSelectors'
import type { EssayReview, ProfessorReviewOutcome, TeacherStanding } from '../../../lib/teacher'
import {
  useSaveTeacherFeedback,
  useSendTeacherFeedback,
  useTeacherEssayCheck,
  useUpdateProfessorReview,
} from '../../../lib/useTeacher'
import { Breadcrumbs, LoadingState, PageHeading, StatusPill } from '../components/TeacherUi'
import { FeedbackDialog } from './FeedbackDialog'

export function EssayCheck({ courseId, assignmentId, studentId, onNavigate, onBack }: {
  courseId: string
  assignmentId: string
  studentId: string
  onNavigate: (studentId: string) => void
  onBack: () => void
}) {
  const essay = useTeacherEssayCheck(courseId, assignmentId, studentId)
  const updateReview = useUpdateProfessorReview()
  const saveFeedback = useSaveTeacherFeedback()
  const sendFeedback = useSendTeacherFeedback()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [draftState, setDraftState] = useState<{ key: string; body: string; citationIds: string[] }>({ key: '', body: '', citationIds: [] })
  const [notice, setNotice] = useState('')

  if (!courseId || !assignmentId || !studentId) return <Empty title="Essay review needs more context" hint="Open a submitted essay from Assignment Detail to start a review." />
  if (essay.isPending) return <LoadingState label="Loading essay review..." />
  if (essay.isError || !essay.data) return <Empty title="Essay review unavailable" hint="This student does not have a local Essay Check record." />

  const data = essay.data
  const draftKey = `${assignmentId}:${studentId}`
  const draft = draftState.key === draftKey
    ? draftState
    : { key: draftKey, body: data.feedback.body, citationIds: data.feedback.citationIds }
  const body = draft.body
  const citationIds = draft.citationIds
  const changeDraft = (patch: Partial<Omit<typeof draft, 'key'>>) => {
    setDraftState({ ...draft, ...patch, key: draftKey })
  }
  const pages = data.reviews.filter((review) => citationIds.includes(review.id)).map((review) => review.sourceLocation)
  const preview = feedbackPreview(body, pages)

  const handleReviewChange = (review: EssayReview, outcome: ProfessorReviewOutcome) => {
    updateReview.mutate({ courseId, assignmentId, studentId, reviewId: review.id, outcome, note: review.professorReview.note })
  }

  const copy = async (text: string, message: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setNotice(message)
    } catch {
      setNotice('Copy is unavailable in this browser.')
    }
    window.setTimeout(() => setNotice(''), 2500)
  }

  const send = async () => {
    await saveFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds })
    await sendFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds })
  }

  return (
    <div className="space-y-7">
      <Breadcrumbs items={[{ label: 'Classes', onClick: onBack }, { label: data.assignment.course }, { label: data.assignment.name }, { label: data.student.name }]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><PageHeading title={data.student.name} description={`${data.student.fileName} · ${data.assignment.name}`} /><div className="flex shrink-0 items-center gap-1"><Button type="button" variant="ghost" disabled={!data.navigation.previous} onClick={() => data.navigation.previous && onNavigate(data.navigation.previous.id)}><ArrowLeft className="size-4" />Previous</Button><Button type="button" variant="ghost" disabled={!data.navigation.next} onClick={() => data.navigation.next && onNavigate(data.navigation.next.id)}>Next<ArrowRight className="size-4" /></Button></div></div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface p-4 text-sm"><FileText className="size-4 text-accent" /><span className="font-medium">{data.student.fileName}</span><span className="text-ink-muted">·</span><span className="text-ink-muted">{data.citationSummary.total} citations</span><span className="ml-auto flex flex-wrap gap-2"><StatusPill label={`${data.citationSummary.contradicted} contradicted`} tone="danger" /><StatusPill label={`${data.citationSummary.silent} silent`} tone="warning" /><StatusPill label={`${data.citationSummary.backed} backed`} tone="success" /></span></div>

      {notice && <div role="status" className="rounded-lg bg-supports-soft px-4 py-3 text-sm text-supports">{notice}</div>}
      <section className="space-y-4" aria-labelledby="citation-review-heading"><div><h2 id="citation-review-heading" className="font-serif text-2xl font-semibold">Citation review</h2><p className="mt-1 text-sm text-ink-muted">Check each claim against the source, then add only the citations you want to mention in feedback.</p></div>{data.reviews.map((review, index) => <CitationCard key={review.id} review={review} index={index} included={citationIds.includes(review.id)} updating={updateReview.isPending} onToggle={() => changeDraft({ citationIds: toggleFeedbackReview(citationIds, review.id) })} onReviewChange={(outcome) => handleReviewChange(review, outcome)} onShowPaper={() => showPaper(review)} />)}</section>

      <Card className="border-accent bg-accent-soft/25"><div className="flex flex-col gap-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">Feedback</p><h2 className="mt-1 font-serif text-2xl font-semibold">Write to {data.student.name}</h2></div><MessageSquarePlus className="size-5 text-accent" /></div><textarea value={body} onChange={(event) => changeDraft({ body: event.target.value })} rows={7} aria-label="Feedback to student" className="w-full resize-y rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-6 placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent" placeholder="Write feedback for the student..." /><p className="text-xs leading-5 text-ink-muted">{preview}</p><div className="flex flex-col gap-3 border-t border-accent/20 pt-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-ink-muted">{citationIds.length} citation{citationIds.length === 1 ? '' : 's'} included</span><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={() => void copy(body, 'Feedback copied locally.')}><Copy className="size-4" />Copy</Button><Button type="button" onClick={() => setFeedbackOpen(true)} disabled={!body.trim() || saveFeedback.isPending}><Send className="size-4" />Send to student</Button></div></div></div></Card>

      <FeedbackDialog open={feedbackOpen} studentName={data.student.name} preview={preview} onClose={() => setFeedbackOpen(false)} onSend={send} />
    </div>
  )
}

function CitationCard({ review, index, included, updating, onToggle, onReviewChange, onShowPaper }: { review: EssayReview; index: number; included: boolean; updating: boolean; onToggle: () => void; onReviewChange: (outcome: ProfessorReviewOutcome) => void; onShowPaper: () => void }) {
  const tone = standingTone(review.standing)
  return <Card className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-accent">{index + 1}</span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">{review.citation}</p><h3 className="mt-1 text-base font-semibold leading-6">{review.claim}</h3></div></div><StatusPill label={standingLabel(review.standing)} tone={tone} /></div><div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg bg-canvas p-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Source passage · {review.sourceLocation}</p><p className="mt-3 text-sm italic leading-6 text-ink">{review.sourceQuote}</p>{review.explanation && <p className="mt-3 text-xs leading-5 text-ink-muted">{review.explanation}</p>}</div><div className="space-y-3"><label className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Professor result<select value={review.professorReview.outcome} disabled={updating} onChange={(event) => onReviewChange(event.target.value as ProfessorReviewOutcome)} className="mt-2 w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm font-normal normal-case tracking-normal"><option value="not-reviewed">Not reviewed</option><option value="supports">Supports claim</option><option value="contradicts">Contradicts claim</option><option value="inconclusive">Inconclusive</option></select></label>{review.supportingUrls.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-medium text-accent hover:underline"><ExternalLink className="size-3.5" />{source.title ?? source.url}</a>)}</div></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4"><button type="button" onClick={onShowPaper} className="text-sm font-medium text-accent hover:underline">Show in paper</button><button type="button" onClick={onToggle} className={included ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white' : 'inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-ink-muted hover:border-accent hover:text-accent'}>{included ? <Check className="size-4" /> : <MessageSquarePlus className="size-4" />}{included ? 'Added to feedback' : 'Add to feedback'}</button></div></Card>
}

function standingTone(standing: TeacherStanding): 'success' | 'warning' | 'danger' | 'neutral' {
  return standing === 'supports' ? 'success' : standing === 'refutes' ? 'danger' : standing === 'insufficient' ? 'warning' : 'neutral'
}

function standingLabel(standing: TeacherStanding): string {
  return standing === 'supports' ? 'Source backs it' : standing === 'refutes' ? 'Source contradicts' : standing === 'insufficient' ? 'Source is silent' : 'Not checked'
}

function showPaper(review: EssayReview) {
  const url = review.paperUrl ?? review.supportingUrls[0]?.url
  if (url) window.open(`${url}#page=${review.sourceLocation.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer')
}
