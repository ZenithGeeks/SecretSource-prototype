import { Check, FileText, MessageSquarePlus, Save } from 'lucide-react'
import { useRef, useState } from 'react'

import { AnalysisView } from '../../../components/AnalysisView'
import { Button, Card, Empty } from '../../../components/ui'
import { API_BASE, fetchFile, paperName, type Analysis, type Claim } from '../../../lib/api'
import { downloadText } from '../../../lib/csv'
import { feedbackPreview, toggleFeedbackReview } from '../../../lib/teacherSelectors'
import { teacherRemoteEnabled, type EssayReview, type ProfessorReviewOutcome } from '../../../lib/teacher'
import {
  cropSubmissionPassages,
  printTeacherFeedbackReport,
  teacherFeedbackMarkdown,
  teacherFeedbackCsv,
  defaultFeedbackSharing,
  type FeedbackSharingByCitation,
  type FeedbackSharingOptions,
  type TeacherFeedbackReport,
} from '../../../lib/teacherFeedbackExport'
import { teacherFeedbackPdfHtml } from '../../../lib/teacherFeedbackPdf'
import { useAnalysis } from '../../../lib/useAnalysis'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import {
  useAnalyzeTeacherSubmission,
  useSaveTeacherFeedback,
  useRefreshTeacherClass,
  useSendTeacherFeedback,
  useTeacherGoogleConnection,
  useTeacherEssayCheck,
  useUpdateProfessorReview,
} from '../../../lib/useTeacher'
import { Breadcrumbs, LoadingState } from '../components/TeacherUi'
import { TeacherDialog } from '../components/TeacherDialog'
import { FeedbackDialog } from './FeedbackDialog'
import { EssayCheckActions } from './EssayCheckActions'

async function buildFeedbackData(analysis: Analysis | undefined, reviews: EssayReview[], selectedIds: string[], sharingOptions: FeedbackSharingByCitation, student: string, course: string, assignment: string, feedback: string, fileName?: string, includeCrops = false): Promise<TeacherFeedbackReport> {
  if (!analysis) return { course, assignment, fileName, student, feedback, claims: [] }
  const selected = analysis.claims.flatMap((claim, claimIndex) => claim.citations.flatMap((citation, citationIndex) => {
    const id = reviewIdFor(claim, claimIndex, citationIndex)
    const review = reviews.find((item) => item.id === id)
    return selectedIds.includes(id) && review ? [{ claim, citation, review, options: { ...defaultFeedbackSharing, ...sharingOptions[id] } }] : []
  }))
  const pdfName = paperName(analysis.file ?? fileName ?? 'submission.pdf')
  const pdf = includeCrops && selected.some(({ claim }) => claim.source)
    ? await fetchFile(`${API_BASE}/api/papers/${encodeURIComponent(pdfName)}`)
    : null
  const pdfBytes = pdf ? await pdf.arrayBuffer() : undefined
  const crops = pdfBytes ? await cropSubmissionPassages(pdfBytes, selected.map(({ claim }) => claim.source)) : []
  const claims = selected.map(({ claim, citation, review, options }, index) => ({
    claim: claim.claim,
    sentence: claim.sentence,
    sourcePage: claim.source?.page,
    standing: options.automated ? review.standing : '',
    judgment: options.automated ? review.standing === 'supports' ? 'Supports'
      : review.standing === 'refutes' ? 'Contradicts'
        : review.standing === 'unchecked' ? 'Not checked' : 'Inconclusive' : '',
    teacherDecision: options.teacherDecision && review.professorReview.outcome !== 'not-reviewed'
      ? review.professorReview.outcome === 'supports' ? 'Supports'
        : review.professorReview.outcome === 'contradicts' ? 'Contradicts' : 'Inconclusive'
      : undefined,
    teacherNote: options.teacherNote ? review.professorReview.note || undefined : undefined,
    reasoning: options.automated ? review.explanation : undefined,
    evidence: options.evidence ? review.sourceQuote : undefined,
    sourceName: citation.title || citation.doi || citation.url,
    cropDataUrl: crops[index],
  }))
  return { course, assignment, fileName: fileName ?? pdfName, student, feedback, claims }
}

async function buildFeedbackHtml(analysis: Analysis, reviews: EssayReview[], selectedIds: string[], sharingOptions: FeedbackSharingByCitation, student: string, course: string, assignment: string, feedback: string, fileName: string) {
  const report = await buildFeedbackData(analysis, reviews, selectedIds, sharingOptions, student, course, assignment, feedback, fileName, true)
  return teacherFeedbackPdfHtml(report)
}

function reviewIdFor(claim: Claim, claimIndex: number, citationIndex: number) {
  const citation = claim.citations[citationIndex]
  const key = citation.doi || citation.arxiv || citation.title || citation.url || citation.ref || ''
  return `claim-${claimIndex}:${key}:${citationIndex}`
}

/** Teacher's single-submission review: submitted paper beside claims, with feedback in the same flow. */
export function EssayCheck({ courseId, assignmentId, studentId, onBack, onNavigate, onReconnectGoogle }: {
  courseId: string
  assignmentId: string
  studentId: string
  onBack: () => void
  onNavigate: (route: TeacherRoute) => void
  onReconnectGoogle?: () => void
}) {
  const essay = useTeacherEssayCheck(courseId, assignmentId, studentId)
  const analyze = useAnalyzeTeacherSubmission()
  const updateReview = useUpdateProfessorReview()
  const saveFeedback = useSaveTeacherFeedback()
  const refreshClassroom = useRefreshTeacherClass()
  const sendFeedback = useSendTeacherFeedback()
  const googleConnection = useTeacherGoogleConnection()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [recheckOpen, setRecheckOpen] = useState(false)
  const [draftState, setDraftState] = useState<{ key: string; body: string; citationIds: string[]; sharingOptions: FeedbackSharingByCitation }>({ key: '', body: '', citationIds: [], sharingOptions: {} })
  const [notice, setNotice] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const analysisData = useAnalysis(essay.data?.analysis?.id ?? null)
  const feedbackRef = useRef<HTMLDivElement>(null)

  if (!courseId || !assignmentId || !studentId) {
    return <Empty title="Essay check needs more context" hint="Open a submitted essay from Assignment Detail to review it." />
  }
  if (essay.isPending) return <LoadingState label="Loading essay check..." />
  if (essay.isError || !essay.data) {
    const hint = essay.isError && essay.error instanceof Error
      ? `The teacher service could not load this essay check: ${essay.error.message}`
      : 'There is no essay check record for this student yet.'
    return (
      <div className="space-y-3">
        <Empty title="Essay check unavailable" hint={hint} />
        <div className="flex justify-center">
          <Button type="button" variant="ghost" onClick={() => void essay.refetch()}>Try again</Button>
        </div>
      </div>
    )
  }

  const data = essay.data
  const analysis = data.analysis
  const canAnalyze = !analysis || (analysis.status !== 'done' && analysis.status !== 'running')
  const draftKey = `${courseId}:${assignmentId}:${studentId}:${analysis?.id ?? ''}`
  const recheckBusy = analyze.isPending || analysis?.status === 'running'
  const draft = draftState.key === draftKey
    ? draftState
    : { key: draftKey, body: data.feedback.body, citationIds: data.feedback.citationIds, sharingOptions: data.feedback.sharingOptions ?? {} }
  const { body, citationIds, sharingOptions } = draft
  const gmailScope = 'https://www.googleapis.com/auth/gmail.send'
  const classroomEmailScope = 'https://www.googleapis.com/auth/classroom.profile.emails'
  const missingClassroomEmailScope = Boolean(
    googleConnection.data?.connected
    && googleConnection.data.scopes
    && !googleConnection.data.scopes.includes(classroomEmailScope),
  )
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
          ? missingClassroomEmailScope
            ? 'Google needs permission to read student email addresses. Reconnect your Google account, then sync Classroom again.'
            : "Sync Classroom to fetch the student's email address."
          : !googleConnection.data?.connected
            ? 'Connect your Google account in teacher settings before sending.'
            : !googleConnection.data.email
              ? 'Could not identify the connected Google email account. Reconnect Google before sending.'
              : !googleConnection.data.scopes?.includes(gmailScope)
                ? 'Reconnect Google and grant Gmail sending permission before sending.'
                : ''
  const changeDraft = (patch: Partial<Omit<typeof draft, 'key'>>) => setDraftState({ ...draft, ...patch, key: draftKey })
  const changeSharing = (reviewId: string, key: keyof FeedbackSharingOptions, value: boolean) =>
    changeDraft({ sharingOptions: { ...sharingOptions, [reviewId]: { ...defaultFeedbackSharing, ...sharingOptions[reviewId], [key]: value } } })
  const preview = feedbackPreview(body, data.reviews.filter((review) => citationIds.includes(review.id)).map((review) => review.sourceLocation))

  const handleReviewChange = (review: EssayReview, outcome: ProfessorReviewOutcome, note = review.professorReview.note) => {
    updateReview.mutate({ courseId, assignmentId, studentId, reviewId: review.id, outcome, note })
  }

  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setNotice('Feedback copied as Markdown.')
    } catch {
      setNotice('Copy is unavailable in this browser.')
    }
    window.setTimeout(() => setNotice(''), 2500)
  }

  const copyStudentFeedback = async () => {
    try {
      const reportAnalysis = analysisData.data?.status === 'done' ? analysisData.data : undefined
      const report = await buildFeedbackData(reportAnalysis, data.reviews, citationIds, sharingOptions, data.student.name, data.assignment.course, data.assignment.name, body, data.student.fileName)
      await copy(teacherFeedbackMarkdown(report))
    } catch (error) {
      setNotice(error instanceof Error ? `Could not prepare feedback: ${error.message}` : 'Could not prepare feedback.')
      window.setTimeout(() => setNotice(''), 2500)
    }
  }

  const save = async () => {
    try {
      await saveFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds, sharingOptions })
      setNotice('Feedback draft saved.')
    } catch (error) {
      setNotice(error instanceof Error ? `Could not save feedback: ${error.message}` : 'Could not save feedback.')
    }
    window.setTimeout(() => setNotice(''), 2500)
  }

  const send = async () => {
    if (!deliveryReady) throw new Error(deliveryIssue)
    await saveFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds, sharingOptions })
    const reportHtml = analysisData.data?.status === 'done'
      ? await buildFeedbackHtml(analysisData.data, data.reviews, citationIds, sharingOptions, data.student.name, data.assignment.course, data.assignment.name, body, data.student.fileName)
      : undefined
    await sendFeedback.mutateAsync({ courseId, assignmentId, studentId, body, citationIds, sharingOptions, reportHtml })
  }

  const exportFeedbackPdf = async () => {
    const reportAnalysis = analysisData.data
    if (!data.analysis?.id || !reportAnalysis || reportAnalysis.status !== 'done') return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setNotice('Allow pop-ups for this site to export the feedback PDF.')
      return
    }
    setExportingPdf(true)
    setNotice('')
    try {
      const report = await buildFeedbackHtml(reportAnalysis, data.reviews, citationIds, sharingOptions, data.student.name, data.assignment.course, data.assignment.name, body, data.student.fileName)
      await printTeacherFeedbackReport(printWindow, report)
      setNotice('Feedback report opened for printing. Choose Save as PDF in the print dialog.')
    } catch (error) {
      printWindow.close()
      setNotice(error instanceof Error ? `Could not prepare feedback PDF: ${error.message}` : 'Could not prepare feedback PDF.')
    } finally {
      setExportingPdf(false)
    }
  }

  const exportFeedbackCsv = async () => {
    const reportAnalysis = analysisData.data?.status === 'done' ? analysisData.data : undefined
    const report = await buildFeedbackData(reportAnalysis, data.reviews, citationIds, sharingOptions, data.student.name, data.assignment.course, data.assignment.name, body, data.student.fileName)
    const safeName = data.student.name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'student'
    downloadText(`essay-feedback-${safeName}.csv`, teacherFeedbackCsv(report), 'text/csv;charset=utf-8')
    setNotice('Feedback CSV downloaded.')
    window.setTimeout(() => setNotice(''), 2500)
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
        const title = citation.title || citation.doi || citation.url || `Source ${citationIndex + 1}`
        const supportUrl = citation.url || (citation.doi ? `https://doi.org/${citation.doi}` : citation.arxiv ? `https://arxiv.org/abs/${citation.arxiv}` : '')
        return (
          <div key={reviewId} className="space-y-3 rounded-xl border border-border-subtle bg-canvas p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 text-sm font-medium text-ink">{title}</span>
              {supportUrl && <a href={supportUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline">Open source</a>}
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <label className="space-y-1 text-xs font-medium text-ink-muted">
                <span>Human final decision</span>
                <select aria-label={`Human final decision for ${title}`} value={review.professorReview.outcome} disabled={updateReview.isPending} onChange={(event) => handleReviewChange(review, event.target.value as ProfessorReviewOutcome)} className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink">
                  <option value="not-reviewed">Not reviewed</option><option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="inconclusive">Inconclusive</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-ink-muted">
                <span>Private teacher note</span>
                <input aria-label={`Teacher note for ${title}`} defaultValue={review.professorReview.note} disabled={updateReview.isPending} onBlur={(event) => handleReviewChange(review, review.professorReview.outcome, event.currentTarget.value)} placeholder="Add a note about your decision" className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted" />
              </label>
            </div>
            <button type="button" onClick={() => changeDraft({ citationIds: toggleFeedbackReview(citationIds, reviewId) })} aria-pressed={included} className={included ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white' : 'inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent'}>
              {included ? <Check className="size-4" /> : <MessageSquarePlus className="size-4" />}{included ? 'Added to feedback' : 'Add to feedback'}
            </button>
            <div className="grid gap-x-4 gap-y-2 border-t border-border-subtle pt-3 sm:grid-cols-2">
              {([
                ['automated', 'Include automated finding'],
                ['evidence', 'Include source evidence'],
                ['teacherDecision', 'Share my final decision'],
                ['teacherNote', 'Share my teacher note'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={(sharingOptions[reviewId]?.[key] ?? defaultFeedbackSharing[key])} onChange={(event) => changeSharing(reviewId, key, event.target.checked)} className="size-4 accent-accent" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-4">
      {analysis?.id && <div className="flex justify-end">
        <Button type="button" variant="ghost" disabled={recheckBusy} onClick={() => setRecheckOpen(true)}>
          {analyze.isPending ? 'Starting analysis...' : 'Recheck essay'}
        </Button>
      </div>}
      <TeacherDialog
        open={recheckOpen}
        title="Recheck this essay?"
        description="This will run a fresh API analysis for this student and reset saved review decisions and feedback. It may take several minutes."
        onClose={() => setRecheckOpen(false)}
      >
        <p className="text-sm text-ink-muted">{data.student.name} — {data.student.fileName}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setRecheckOpen(false)}>Cancel</Button>
          <Button type="button" disabled={recheckBusy} onClick={() => {
            if (recheckBusy) return
            setRecheckOpen(false)
            setNotice('')
            analyze.mutate({ courseId, assignmentId, studentId, force: true })
          }}>Recheck</Button>
        </div>
      </TeacherDialog>
      <Breadcrumbs items={[
        { label: 'Classes', onClick: () => onNavigate({ screen: 'classes' }) },
        { label: data.assignment.course, onClick: () => onNavigate({ screen: 'class-overview', courseId }) },
        { label: data.assignment.name, onClick: onBack },
      ]} />

      {analysis?.status === 'running' && (
        <div role="status"><Card className="flex items-center gap-3 py-3">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          <p className="text-sm text-ink-muted">Analysis is running. Results will appear here automatically.</p>
        </Card></div>
      )}
      {analysis?.error && <div role="alert"><Card className="border-refutes text-sm text-refutes">{analysis.error}</Card></div>}
      {analyze.isError && <div role="alert"><Card className="border-refutes text-sm text-refutes">{analyze.error instanceof Error ? analyze.error.message : 'Essay analysis could not start.'}</Card></div>}
      {notice && <div role="status" className="rounded-lg bg-supports-soft px-4 py-3 text-sm text-supports">{notice}</div>}
      {canAnalyze && (
        <Card className="mx-auto flex min-h-64 w-full max-w-[620px] flex-col items-center justify-center px-8 text-center">
          <FileText className="size-7 text-accent" />
          <h1 className="mt-4 font-serif text-[26px] font-semibold leading-tight">{data.student.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{data.student.fileName} · {data.assignment.name}</p>
          <p className="mt-4 max-w-md text-sm leading-6 text-ink-muted">Run the submitted essay through the claim and citation analysis to review the PDF alongside its findings.</p>
          <Button type="button" className="mt-5" onClick={() => analysis?.id ? setRecheckOpen(true) : analyze.mutate({ courseId, assignmentId, studentId })} disabled={analyze.isPending}>
            {analyze.isPending ? 'Starting analysis...' : 'Check essay'}
          </Button>
        </Card>
      )}

      {analysis?.id && <AnalysisView
        key={analysis.id}
        id={analysis.id}
        presentation="teacher"
        openPaperOnLoad
        paperLabel={`${data.student.name} - ${data.student.fileName}`}
        onTeacherFeedback={() => feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        renderClaimActions={renderClaimActions}
      />}

      <div ref={feedbackRef} className="scroll-mt-6">
      <Card className="border-accent/30 bg-accent-soft/15 p-5 sm:p-6">
        <section aria-labelledby="teacher-feedback-heading" className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.7px] text-accent">Student feedback</p>
              <h2 id="teacher-feedback-heading" className="mt-1 font-serif text-2xl font-semibold leading-[30px] text-ink">Write to {data.student.name}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">Add a personal note and choose which reviewed citations to include.</p>
            </div>
            <MessageSquarePlus className="mt-1 size-5 shrink-0 text-accent" aria-hidden="true" />
          </div>
          <label className="sr-only" htmlFor="teacher-feedback-body">Feedback to student</label>
          <textarea id="teacher-feedback-body" value={body} onChange={(event) => changeDraft({ body: event.target.value })} rows={6} aria-label="Feedback to student" className="w-full resize-y rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-6 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent" placeholder="Write feedback for the student..." />
          <div className="rounded-xl border border-border-subtle/70 bg-surface/65 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Student preview</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{body.trim() || 'Your written feedback will appear here.'}</p>
            {citationIds.length > 0 && <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
              {data.reviews.filter((review) => citationIds.includes(review.id)).map((review) => {
                const options = { ...defaultFeedbackSharing, ...sharingOptions[review.id] }
                const result = review.standing === 'supports' ? 'Supports' : review.standing === 'refutes' ? 'Contradicts' : review.standing === 'unchecked' ? 'Not checked' : 'Inconclusive'
                return <div key={review.id} className="space-y-1 text-sm">
                  <p className="font-medium text-ink">{review.claim}</p>
                  <p className="text-xs text-ink-muted">{review.citation}{review.sourceLocation ? ` · ${review.sourceLocation}` : ''}</p>
                  {options.automated && <p className="text-xs text-ink-muted">Automated finding: {result}{review.explanation ? ` — ${review.explanation}` : ''}</p>}
                  {options.evidence && review.sourceQuote && <blockquote className="border-l-2 border-accent/50 pl-3 text-xs text-ink-muted">{review.sourceQuote}</blockquote>}
                  {options.teacherDecision && review.professorReview.outcome !== 'not-reviewed' && <p className="text-xs text-ink-muted">Teacher decision: {review.professorReview.outcome}</p>}
                  {options.teacherNote && review.professorReview.note && <p className="text-xs text-ink-muted">Teacher note: {review.professorReview.note}</p>}
                </div>
              })}
            </div>}
          </div>
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-ink-muted">{citationIds.length} source{citationIds.length === 1 ? '' : 's'} included</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="px-3 py-2 text-xs" type="button" variant="ghost" onClick={() => void save()} disabled={saveFeedback.isPending}>
                <Save className="size-4" />{saveFeedback.isPending ? 'Saving...' : 'Save draft'}
              </Button>
              <EssayCheckActions
                onCopy={() => void copyStudentFeedback()}
                onDownloadReport={() => void exportFeedbackPdf()}
                onDownloadCsv={() => void exportFeedbackCsv()}
                onSend={() => setFeedbackOpen(true)}
                reportDisabled={data.analysis?.status !== 'done' || analysisData.isPending}
                reportBusy={exportingPdf}
                sendDisabled={!body.trim() || saveFeedback.isPending || sendFeedback.isPending}
                compact
              />
            </div>
          </div>
          <p className="text-xs leading-5 text-ink-muted">Only selected citations and checked fields appear in the student report. Automated findings and source evidence are included by default; final decisions and teacher notes stay private until you choose to share them.</p>
        </section>
      </Card>
      </div>

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
        onRefreshClassroom={missingClassroomEmailScope ? undefined : () => refreshClassroom.mutate(courseId)}
        onReconnectGoogle={missingClassroomEmailScope ? onReconnectGoogle : undefined}
        refreshingClassroom={refreshClassroom.isPending}
        refreshClassroomError={refreshClassroom.isError ? (refreshClassroom.error instanceof Error ? refreshClassroom.error.message : 'Please try again.') : undefined}
      />
    </div>
  )
}
