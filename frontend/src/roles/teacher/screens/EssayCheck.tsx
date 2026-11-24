import { Check, ChevronLeft, FileText, MessageSquarePlus, Save } from 'lucide-react'
import { useRef, useState } from 'react'

import { AnalysisView } from '../../../components/AnalysisView'
import { Button, Card, Empty } from '../../../components/ui'
import { paperName, requestBlob, type Analysis, type Claim } from '../../../lib/api'
import { downloadText } from '../../../lib/csv'
import { toggleFeedbackReview } from '../../../lib/teacherSelectors'
import { teacherRemoteEnabled, type EssayReview, type ProfessorReviewOutcome } from '../../../lib/teacher'
import {
  teacherFeedbackMarkdown,
  teacherFeedbackCsv,
  defaultFeedbackSharing,
  resolveFeedbackSharing,
  type FeedbackSharingByCitation,
  type FeedbackSharingOptions,
  type TeacherFeedbackReport,
} from '../../../lib/teacherFeedbackExport'
import { teacherFeedbackPdfHtml } from '../../../lib/teacherFeedbackPdf'
import { useAnalysis } from '../../../lib/useAnalysis'
import {
  useAnalyzeTeacherSubmission,
  useSaveTeacherFeedback,
  useRefreshTeacherClass,
  useSendTeacherFeedback,
  useTeacherAssignmentDetail,
  useTeacherGoogleConnection,
  useTeacherEssayCheck,
  useTeacherWorkspace,
  useUpdateProfessorReview,
} from '../../../lib/useTeacher'
import { LoadingState } from '../components/TeacherUi'
import { TeacherDialog } from '../components/TeacherDialog'
import { FeedbackDialog } from './FeedbackDialog'
import { EssayCheckActions } from './EssayCheckActions'

async function buildFeedbackData(analysis: Analysis | undefined, reviews: EssayReview[], selectedIds: string[], sharingOptions: FeedbackSharingByCitation, student: string, course: string, assignment: string, feedback: string, fileName?: string): Promise<TeacherFeedbackReport> {
  if (!analysis) return { course, assignment, fileName, student, feedback, claims: [] }
  const selected = analysis.claims.flatMap((claim, claimIndex) => claim.citations.flatMap((citation, citationIndex) => {
    const id = reviewIdFor(claim, claimIndex, citationIndex)
    const review = reviews.find((item) => item.id === id)
    return selectedIds.includes(id) && review ? [{ claim, citation, review, options: resolveFeedbackSharing(sharingOptions[id]) }] : []
  }))
  const pdfName = paperName(analysis.file ?? fileName ?? 'submission.pdf')
  const claims = selected.map(({ claim, citation, review, options }) => ({
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
  }))
  return { course, assignment, fileName: fileName ?? pdfName, student, feedback, claims }
}

function reviewIdFor(claim: Claim, claimIndex: number, citationIndex: number) {
  const citation = claim.citations[citationIndex]
  const key = citation.doi || citation.arxiv || citation.title || citation.url || citation.ref || ''
  return `claim-${claimIndex}:${key}:${citationIndex}`
}

/** Teacher's single-submission review: submitted paper beside claims, with feedback in the same flow. */
export function EssayCheck({ courseId, assignmentId, studentId, onBack, onReconnectGoogle }: {
  courseId: string
  assignmentId: string
  studentId: string
  onBack: () => void
  onReconnectGoogle?: () => void
}) {
  const essay = useTeacherEssayCheck(courseId, assignmentId, studentId)
  const assignmentDetails = useTeacherAssignmentDetail(courseId, assignmentId)
  const workspace = useTeacherWorkspace(courseId)
  const analyze = useAnalyzeTeacherSubmission()
  const updateReview = useUpdateProfessorReview()
  const saveFeedback = useSaveTeacherFeedback()
  const refreshClassroom = useRefreshTeacherClass()
  const sendFeedback = useSendTeacherFeedback()
  const googleConnection = useTeacherGoogleConnection()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [recheckOpen, setRecheckOpen] = useState(false)
  const [draftState, setDraftState] = useState<{ key: string; body: string; subject: string; citationIds: string[]; sharingOptions: FeedbackSharingByCitation }>({ key: '', body: '', subject: '', citationIds: [], sharingOptions: {} })
  const [notice, setNotice] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [reportTitle, setReportTitle] = useState('Essay feedback')
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
  const courseLabel = data.assignment.course !== courseId
    ? data.assignment.course
    : workspace.data?.course.name || 'Class'
  const assignmentLabel = data.assignment.name !== assignmentId
    ? data.assignment.name
    : assignmentDetails.data?.assignment.title || 'Assignment'
  const analysis = data.analysis
  const canAnalyze = !analysis || (analysis.status !== 'done' && analysis.status !== 'running')
  const draftKey = `${courseId}:${assignmentId}:${studentId}:${analysis?.id ?? ''}`
  const recheckBusy = analyze.isPending || analysis?.status === 'running'
  const draft = draftState.key === draftKey
    ? draftState
    : { key: draftKey, body: data.feedback.body, subject: data.feedback.subject || `Essay feedback: ${assignmentLabel}`, citationIds: data.feedback.citationIds, sharingOptions: data.feedback.sharingOptions ?? {} }
  const { body, subject, citationIds, sharingOptions } = draft
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
      await saveFeedback.mutateAsync({ courseId, assignmentId, studentId, body, subject, citationIds, sharingOptions })
      setNotice('Feedback draft saved.')
    } catch (error) {
      setNotice(error instanceof Error ? `Could not save feedback: ${error.message}` : 'Could not save feedback.')
    }
    window.setTimeout(() => setNotice(''), 2500)
  }

  const send = async (subject: string) => {
    if (!deliveryReady) throw new Error(deliveryIssue)
    await saveFeedback.mutateAsync({ courseId, assignmentId, studentId, body, subject, citationIds, sharingOptions })
    const reportAnalysis = analysisData.data?.status === 'done' ? analysisData.data : undefined
    const reportHtml = teacherFeedbackPdfHtml({ ...await buildFeedbackData(reportAnalysis, data.reviews, citationIds, sharingOptions, data.student.name, data.assignment.course, data.assignment.name, body, data.student.fileName), title: reportTitle })
    await sendFeedback.mutateAsync({ courseId, assignmentId, studentId, body, subject, citationIds, sharingOptions, reportHtml })
  }

  const exportFeedbackPdf = async () => {
    const reportAnalysis = analysisData.data
    if (!data.analysis?.id || !reportAnalysis || reportAnalysis.status !== 'done') return
    setExportingPdf(true)
    setNotice('')
    try {
      const report = await buildFeedbackData(reportAnalysis, data.reviews, citationIds, sharingOptions, data.student.name, data.assignment.course, data.assignment.name, body, data.student.fileName)
      const pdf = await requestBlob('/teacher/feedback/report.pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportHtml: teacherFeedbackPdfHtml({ ...report, title: reportTitle }) }) })
      const url = URL.createObjectURL(pdf)
      const link = document.createElement('a')
      link.href = url
      link.download = 'essay-feedback.pdf'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      setNotice('Feedback PDF downloaded.')
    } catch (error) {
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
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Teacher review</p>
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
                <span>Teacher note</span>
                <input aria-label={`Teacher note for ${title}`} defaultValue={review.professorReview.note} disabled={updateReview.isPending} onBlur={(event) => handleReviewChange(review, review.professorReview.outcome, event.currentTarget.value)} placeholder="Add a note about your decision" className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted" />
              </label>
            </div>
            <button type="button" onClick={() => changeDraft({ citationIds: toggleFeedbackReview(citationIds, reviewId) })} aria-pressed={included} className={included ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white' : 'inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent'}>
              {included ? <Check className="size-4" /> : <MessageSquarePlus className="size-4" />}{included ? 'Added to feedback' : 'Add to feedback'}
            </button>
            <div className="grid gap-x-4 gap-y-2 border-t border-border-subtle pt-3 sm:grid-cols-2">
              <p className="text-xs text-ink-muted sm:col-span-2">These choices control the student report generated in this browser.</p>
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
    <div className="mx-auto w-full max-w-360 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-subtle pb-4">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-caption font-medium text-ink-muted hover:text-accent"><ChevronLeft className="size-3.5" />Back to assignment</button>
          <p className="text-micro font-semibold uppercase tracking-widest text-accent">{courseLabel} / Essay review</p>
          <h1 className="mt-1 truncate font-serif text-[30px] leading-9 font-semibold text-ink">{data.student.name} <span className="font-normal text-ink-muted">· {assignmentLabel}</span></h1>
          <p className="mt-1 truncate text-[12px] text-ink-muted">{data.student.fileName} <span aria-hidden="true">·</span> {data.reviews.length} citations to review</p>
        </div>
        {analysis?.id && <Button type="button" variant="ghost" disabled={recheckBusy} onClick={() => setRecheckOpen(true)}>{analyze.isPending ? 'Starting analysis...' : 'Recheck essay'}</Button>}
      </header>
      <TeacherDialog
        open={recheckOpen}
        title="Recheck this essay?"
        description="This will run a fresh analysis for this student. Saved decisions and feedback are cleared only if the submitted file has changed. It may take several minutes."
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
        <Card className="mx-auto flex min-h-64 w-full max-w-150 flex-col items-center justify-center px-8 text-center">
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
        teacherDecisions={{ supports: data.reviews.filter((review) => review.professorReview.outcome === 'supports').length, contradicts: data.reviews.filter((review) => review.professorReview.outcome === 'contradicts').length, inconclusive: data.reviews.filter((review) => review.professorReview.outcome === 'inconclusive').length, notReviewed: data.reviews.filter((review) => review.professorReview.outcome === 'not-reviewed').length }}
      />}

      <div ref={feedbackRef} className="scroll-mt-6">
      <Card className="border-accent/30 bg-accent-soft/15 p-5 sm:p-6">
        <section aria-labelledby="teacher-feedback-heading" className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-caption font-semibold uppercase tracking-[0.04em] text-accent">Student feedback</p>
              <h2 id="teacher-feedback-heading" className="mt-1 font-serif text-2xl font-semibold text-ink">Write to {data.student.name}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">Add a personal note and choose which reviewed citations to include.</p>
            </div>
            <MessageSquarePlus className="mt-1 size-5 shrink-0 text-accent" aria-hidden="true" />
          </div>
          <label className="text-sm font-medium text-ink" htmlFor="teacher-report-title">Feedback report title</label>
          <input id="teacher-report-title" value={reportTitle} maxLength={150} onChange={(event) => setReportTitle(event.target.value)} className="w-full rounded-xl border border-border-subtle bg-surface px-4 py-2 text-sm text-ink" />
          <label className="text-sm font-medium text-ink" htmlFor="teacher-email-subject">Email subject</label>
          <input id="teacher-email-subject" value={subject} maxLength={200} onChange={(event) => changeDraft({ subject: event.target.value })} className="w-full rounded-xl border border-border-subtle bg-surface px-4 py-2 text-sm text-ink" />
          <label className="text-sm font-medium text-ink" htmlFor="teacher-feedback-body">Email message to the student</label>
          <textarea id="teacher-feedback-body" value={body} onChange={(event) => changeDraft({ body: event.target.value })} rows={6} className="w-full resize-y rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-6 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent" placeholder="Write feedback for the student..." />
          <div className="rounded-xl border border-border-subtle/70 bg-surface/65 px-4 py-3">
            <p className="text-caption font-semibold uppercase tracking-widest text-ink-muted">Student preview</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{body.trim() || 'Your written feedback will appear here.'}</p>
            {citationIds.length > 0 && <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
              {data.reviews.filter((review) => citationIds.includes(review.id)).map((review) => {
                const options = resolveFeedbackSharing(sharingOptions[review.id])
                const result = review.standing === 'supports' ? 'Supports' : review.standing === 'refutes' ? 'Contradicts' : review.standing === 'unchecked' ? 'Not checked' : 'Inconclusive'
                const teacherOutcome = review.professorReview.outcome
                const teacherDecision = teacherOutcome === 'supports' ? 'Supports' : teacherOutcome === 'contradicts' ? 'Contradicts' : 'Inconclusive'
                const decisionTone = teacherOutcome === 'supports' ? 'bg-supports-soft text-supports ring-supports/20' : teacherOutcome === 'contradicts' ? 'bg-refutes-soft text-refutes ring-refutes/20' : 'bg-insufficient-soft text-insufficient ring-insufficient/20'
                return <div key={review.id} className="space-y-2 text-sm">
                  <p className="font-medium text-ink">{review.claim}</p>
                  <p className="text-xs text-ink-muted">{review.citation}{review.sourceLocation ? ` · ${review.sourceLocation}` : ''}</p>
                  {options.automated && <p className="text-xs text-ink-muted">Automated finding: {result}{review.explanation ? ` — ${review.explanation}` : ''}</p>}
                  {options.evidence && review.sourceQuote && <blockquote className="border-l-2 border-accent/50 pl-3 text-xs text-ink-muted">{review.sourceQuote}</blockquote>}
                  {options.teacherDecision && teacherOutcome !== 'not-reviewed' && <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${decisionTone}`}>Teacher decision: {teacherDecision}</span>}
                  {options.teacherNote && review.professorReview.note && <p className="rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-ink"><span className="font-semibold">Teacher note:</span> {review.professorReview.note}</p>}
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
                reportDisabled={data.analysis?.status !== 'done' || analysisData.isPending || updateReview.isPending}
                reportBusy={exportingPdf}
                sendDisabled={!body.trim() || saveFeedback.isPending || sendFeedback.isPending || updateReview.isPending}
                compact
              />
            </div>
          </div>
          <p className="text-xs leading-5 text-ink-muted">Only selected citations and checked fields appear in the student report. Teacher decisions and notes are included by default; uncheck either field to keep it private.</p>
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
        preview={body}
        defaultSubject={`Essay feedback: ${assignmentLabel}`}
        subject={subject}
        onSubjectChange={(value) => changeDraft({ subject: value })}
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
