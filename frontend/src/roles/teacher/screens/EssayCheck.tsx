import { ArrowLeft, ArrowRight, Check, MessageSquarePlus } from 'lucide-react'
import { useState } from 'react'

import { AnalysisView } from '../../../components/AnalysisView'
import { Button, Card, Empty } from '../../../components/ui'
import { API_BASE, fetchFile, paperName, type Analysis, type Claim } from '../../../lib/api'
import { standingOf } from '../../../lib/claims'
import { feedbackPreview, toggleFeedbackReview } from '../../../lib/teacherSelectors'
import { teacherRemoteEnabled, type EssayReview, type ProfessorReviewOutcome } from '../../../lib/teacher'
import { cropSubmissionPassages, printTeacherFeedbackReport, teacherFeedbackReport } from '../../../lib/teacherFeedbackExport'
import { useAnalysis } from '../../../lib/useAnalysis'
import {
  useAnalyzeTeacherSubmission,
  useSaveTeacherFeedback,
  useSendTeacherFeedback,
  useTeacherGoogleConnection,
  useTeacherEssayCheck,
  useUpdateProfessorReview,
} from '../../../lib/useTeacher'
import { Breadcrumbs, LoadingState, PageHeading } from '../components/TeacherUi'
import { FeedbackDialog } from './FeedbackDialog'
import { EssayCheckActions } from './EssayCheckActions'

async function buildFeedbackHtml(analysis: Analysis, data: EssayReview[], selectedIds: string[], student: string, course: string, assignment: string, feedback: string) {
  const selectedClaims = analysis.claims.map((claim, index) => ({ claim, index })).filter(({ claim, index }) =>
    claim.citations.some((_citation, citationIndex) => selectedIds.includes(reviewIdFor(claim, index, citationIndex))),
  )
  const pdfName = paperName(analysis.file ?? 'submission.pdf')
  const pdf = selectedClaims.some(({ claim }) => claim.source)
    ? await fetchFile(`${API_BASE}/api/papers/${encodeURIComponent(pdfName)}`)
    : null
  const pdfBytes = pdf ? await pdf.arrayBuffer() : undefined
  const crops = pdfBytes ? await cropSubmissionPassages(pdfBytes, selectedClaims.map(({ claim }) => claim.source)) : []
  const claims = selectedClaims.map(({ claim, index }, reportIndex) => {
    const selectedReviews = claim.citations.flatMap((citation, citationIndex) => {
      const id = reviewIdFor(claim, index, citationIndex)
      const review = data.find((item) => item.id === id)
      return selectedIds.includes(id) && review ? [{ citation, review }] : []
    })
    const verdicts = claim.verdicts ?? []
    const teacherDecisions = selectedReviews.map(({ citation, review }) =>
      `${citation.title || citation.doi || citation.url}: ${review.professorReview.outcome}`,
    )
    return {
      claim: claim.claim,
      sentence: claim.sentence,
      sourcePage: claim.source?.page,
      standing: standingOf(claim),
      judgment: verdicts.some((item) => item.verdict === 'refutes') ? 'Contradicts'
        : verdicts.some((item) => item.verdict === 'supports') ? 'Supports'
          : verdicts.some((item) => item.verdict === 'insufficient') ? 'Inconclusive'
            : claim.unchecked?.length ? 'Not checked' : 'No cited source',
      teacherDecision: teacherDecisions.join('\n'),
      teacherNote: selectedReviews.map(({ review }) => review.professorReview.note).filter(Boolean).join('\n'),
      reasoning: verdicts.map((item) => item.reasoning).filter(Boolean).join('\n') || claim.unchecked?.map((item) => item.message).filter(Boolean).join('\n'),
      evidence: verdicts.map((item) => item.quote).filter(Boolean).join('\n'),
      sourceName: selectedReviews.map(({ citation }) => citation.title || citation.doi || citation.url).join(', '),
      cropDataUrl: crops[reportIndex],
    }
  })
  return teacherFeedbackReport({ course, assignment, student, feedback, claims })
}

function reviewIdFor(claim: Claim, claimIndex: number, citationIndex: number) {
  const citation = claim.citations[citationIndex]
  const key = citation.doi || citation.arxiv || citation.title || citation.url || citation.ref || ''
  return `claim-${claimIndex}:${key}:${citationIndex}`
}

export function EssayCheck({ courseId, assignmentId, studentId, onNavigate, onBack }: {
  courseId: string
  assignmentId: string
  studentId: string
  onNavigate: (studentId: string) => void
  onBack: () => void
}) {
  const essay = useTeacherEssayCheck(courseId, assignmentId, studentId)
  const analyze = useAnalyzeTeacherSubmission()
  const updateReview = useUpdateProfessorReview()
  const saveFeedback = useSaveTeacherFeedback()
  const sendFeedback = useSendTeacherFeedback()
  const googleConnection = useTeacherGoogleConnection()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [draftState, setDraftState] = useState<{ key: string; body: string; citationIds: string[] }>({ key: '', body: '', citationIds: [] })
  const [notice, setNotice] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const analysisData = useAnalysis(essay.data?.analysis?.id ?? null)

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
  const gmailScope = 'https://www.googleapis.com/auth/gmail.send'
  const deliveryReady = Boolean(
    teacherRemoteEnabled
    && data.student.email
    && googleConnection.data?.connected
    && googleConnection.data.email
    && googleConnection.data.scopes?.includes(gmailScope),
  )
  const deliveryIssue = !teacherRemoteEnabled
    ? 'Real email delivery requires the live teacher backend.'
    : googleConnection.isPending
      ? 'Checking the connected Google account...'
      : googleConnection.isError
        ? 'Could not verify the Google email connection. Try again before sending.'
        : !data.student.email
          ? "Refresh Classroom to sync the student's email address."
          : !googleConnection.data?.connected
            ? 'Connect your Google account in teacher settings before sending.'
            : !googleConnection.data.email
              ? 'Could not identify the connected Google email account. Reconnect Google before sending.'
              : !googleConnection.data.scopes?.includes(gmailScope)
                ? 'Reconnect Google and grant Gmail sending permission before sending.'
                : ''
  const changeDraft = (patch: Partial<Omit<typeof draft, 'key'>>) => setDraftState({ ...draft, ...patch, key: draftKey })
  const pages = data.reviews.filter((review) => citationIds.includes(review.id)).map((review) => review.sourceLocation)
  const preview = feedbackPreview(body, pages)

  const handleReviewChange = (review: EssayReview, outcome: ProfessorReviewOutcome, note = review.professorReview.note) => {
    updateReview.mutate({ courseId, assignmentId, studentId, reviewId: review.id, outcome, note })
  }

  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setNotice('Feedback copied locally.')
    } catch {
      setNotice('Copy is unavailable in this browser.')
    }
    window.setTimeout(() => setNotice(''), 2500)
  }

  const send = async () => {
    if (!deliveryReady) throw new Error(deliveryIssue)
    await saveFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds })
    const reportHtml = analysisData.data?.status === 'done'
      ? await buildFeedbackHtml(analysisData.data, data.reviews, citationIds, data.student.name, data.assignment.course, data.assignment.name, body)
      : undefined
    await sendFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds, reportHtml })
  }

  const exportFeedbackPdf = async () => {
    const analysis = analysisData.data
    if (!data.analysis?.id || !analysis || analysis.status !== 'done') return
    // Open synchronously within the click gesture so popup blockers allow the report window.
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setNotice('Allow pop-ups for this site to export the feedback PDF.')
      return
    }
    setExportingPdf(true)
    setNotice('')
    try {
      const report = await buildFeedbackHtml(analysis, data.reviews, citationIds, data.student.name, data.assignment.course, data.assignment.name, body)
      await printTeacherFeedbackReport(printWindow, report)
      setNotice('Feedback report opened for printing. Choose Save as PDF in the print dialog.')
    } catch (error) {
      printWindow.close()
      setNotice(error instanceof Error ? `Could not prepare feedback PDF: ${error.message}` : 'Could not prepare feedback PDF.')
    } finally {
      setExportingPdf(false)
    }
  }

  const renderClaimActions = (claim: Claim, claimIndex: number) => (
    <div className="space-y-3 border-t border-border-subtle pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Teacher review</p>
      {claim.citations.length === 0 && <p className="text-sm text-ink-muted">This claim has no cited source to include in student feedback.</p>}
      {claim.citations.map((citation, citationIndex) => {
        const reviewId = reviewIdFor(claim, claimIndex, citationIndex)
        const review = data.reviews.find((item) => item.id === reviewId)
        if (!review) return null
        const included = citationIds.includes(reviewId)
        const supportUrl = citation.url || (citation.doi ? `https://doi.org/${citation.doi}` : citation.arxiv ? `https://arxiv.org/abs/${citation.arxiv}` : '')
        return (
          <div key={reviewId} className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas p-3">
            <span className="min-w-0 flex-1 text-sm font-medium">{citation.title || citation.doi || citation.url || `Source ${citationIndex + 1}`}</span>
            {supportUrl && <a href={supportUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline">Open support document</a>}
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              Human final decision
              <select aria-label={`Human final decision for ${citation.title || `source ${citationIndex + 1}`}`} value={review.professorReview.outcome} disabled={updateReview.isPending} onChange={(event) => handleReviewChange(review, event.target.value as ProfessorReviewOutcome)} className="rounded border border-border-subtle bg-surface px-2 py-1 text-sm text-ink">
                <option value="not-reviewed">Not reviewed</option><option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="inconclusive">Inconclusive</option>
              </select>
            </label>
            <input
              aria-label={`Teacher note for ${citation.title || `source ${citationIndex + 1}`}`}
              defaultValue={review.professorReview.note}
              disabled={updateReview.isPending}
              onBlur={(event) => handleReviewChange(review, review.professorReview.outcome, event.currentTarget.value)}
              placeholder="Add a note for your decision"
              className="min-w-48 flex-1 rounded border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted"
            />
            <button type="button" onClick={() => changeDraft({ citationIds: toggleFeedbackReview(citationIds, reviewId) })} aria-pressed={included} className={included ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white' : 'inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent'}>
              {included ? <Check className="size-4" /> : <MessageSquarePlus className="size-4" />}{included ? 'Added to feedback' : 'Add to feedback'}
            </button>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-7">
      <Breadcrumbs items={[{ label: 'Classes', onClick: onBack }, { label: data.assignment.course }, { label: data.assignment.name }, { label: data.student.name }]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading title={data.student.name} description={`${data.student.fileName} · ${data.assignment.name}`} />
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" disabled={!data.navigation.previous} onClick={() => data.navigation.previous && onNavigate(data.navigation.previous.id)}><ArrowLeft className="size-4" />Previous</Button>
          <Button type="button" variant="ghost" disabled={!data.navigation.next} onClick={() => data.navigation.next && onNavigate(data.navigation.next.id)}>Next<ArrowRight className="size-4" /></Button>
        </div>
      </div>

      {notice && <div role="status" className="rounded-lg bg-supports-soft px-4 py-3 text-sm text-supports">{notice}</div>}
      {data.analysis && data.analysis.status !== 'done' && data.analysis.status !== 'running' && (
        <Card className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Analyze submitted essay</h2><p className="mt-1 text-sm text-ink-muted">The student's PDF will run through the shared research analysis pipeline.</p></div><Button type="button" onClick={() => analyze.mutate({ courseId, assignmentId, studentId })} disabled={analyze.isPending}>{analyze.isPending ? 'Starting analysis...' : 'Check essay'}</Button></Card>
      )}
      {data.analysis?.status === 'running' && <p role="status" className="text-sm text-ink-muted">Essay analysis is running. Its pipeline stages and results appear here as they arrive.</p>}
      {analyze.isError && <p role="alert" className="text-sm text-insufficient">{analyze.error instanceof Error ? analyze.error.message : 'Essay analysis could not start.'}</p>}
      {data.analysis?.error && <p role="alert" className="text-sm text-insufficient">{data.analysis.error}</p>}
      {data.analysis?.id && <AnalysisView key={data.analysis.id} id={data.analysis.id} presentation="teacher" openPaperOnLoad renderClaimActions={renderClaimActions} />}

      <Card className="border-accent bg-accent-soft/25">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">Feedback</p><h2 className="mt-1 font-serif text-2xl font-semibold">Write to {data.student.name}</h2></div><MessageSquarePlus className="size-5 text-accent" /></div>
          <textarea value={body} onChange={(event) => changeDraft({ body: event.target.value })} rows={7} aria-label="Feedback to student" className="w-full resize-y rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-6 placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent" placeholder="Write feedback for the student..." />
          <p className="text-xs leading-5 text-ink-muted">{preview}</p>
          <div className="flex flex-col gap-3 border-t border-accent/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-ink-muted">{citationIds.length} claim citation{citationIds.length === 1 ? '' : 's'} selected for student feedback</span>
            <EssayCheckActions
              claims={analysisData.data?.claims ?? []}
              onCopy={() => void copy(body)}
              onDownloadReport={() => void exportFeedbackPdf()}
              onSend={() => setFeedbackOpen(true)}
              reportDisabled={data.analysis?.status !== 'done' || analysisData.isPending}
              reportBusy={exportingPdf}
              sendDisabled={!body.trim() || saveFeedback.isPending || sendFeedback.isPending}
              csvDisabled={analysisData.isPending || analysisData.data?.status !== 'done'}
            />
          </div>
          <p className="text-xs text-ink-muted">Only claim citations you add above are included in the report sent to the student.</p>
        </div>
      </Card>

      <FeedbackDialog
        open={feedbackOpen}
        studentName={data.student.name}
        recipientEmail={data.student.email}
        senderEmail={googleConnection.data?.email}
        deliveryReady={deliveryReady}
        deliveryIssue={deliveryIssue}
        preview={preview}
        onClose={() => setFeedbackOpen(false)}
        onSend={send}
      />
    </div>
  )
}
