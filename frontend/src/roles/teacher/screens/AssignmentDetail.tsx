import { ArrowUpRight, FileText, Link2, RefreshCw } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherAssignmentDetail, useTeacherWorkspace } from '../../../lib/useTeacher'
import type { TeacherSubmission } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { Breadcrumbs, LoadingState, MetricCard, StatusPill } from '../components/TeacherUi'

export function AssignmentDetail({ courseId, assignmentId, onOpenEssay, onNavigate, onRefresh }: {
  courseId: string
  assignmentId: string
  onOpenEssay: (studentId: string) => void
  onNavigate: (route: TeacherRoute) => void
  onRefresh: () => void
}) {
  const detail = useTeacherAssignmentDetail(courseId, assignmentId)
  const workspace = useTeacherWorkspace(courseId)
  if (detail.isPending || workspace.isPending) return <LoadingState label="Loading assignment..." />
  if (detail.isError || !detail.data) return <Empty title="Assignment unavailable" hint="Return to Classwork and choose an assignment from Classroom." />

  const { assignment, submissions } = detail.data
  const course = workspace.data
  const firstSubmitted = submissions.find((submission) => submission.state !== 'missing' && submission.attachments.length > 0)
  return (
    <div className="space-y-3">
      <Breadcrumbs items={[
        { label: 'Classes', onClick: () => onNavigate({ screen: 'classes' }) },
        { label: `${course?.course.name ?? 'Class'} · ${course?.course.section ?? ''}`, onClick: () => onNavigate({ screen: 'class-overview', courseId }) },
        { label: assignment.title },
      ]} />
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="font-serif text-[29px] font-semibold leading-[41px]">{assignment.title}</h1><p className="text-[11px] text-ink-muted">Assignment details · Google Classroom</p></div>
        <button type="button" onClick={onRefresh} disabled={workspace.isFetching} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-muted hover:bg-accent-soft"><RefreshCw className={workspace.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />Refresh</button>
      </header>

      <div role="tablist" aria-label="Class workspace" className="flex min-h-[44px] items-center gap-1.5 border-b border-border-subtle py-1">
        <button type="button" role="tab" aria-selected="true" onClick={() => onNavigate({ screen: 'classwork', courseId })} className="rounded-lg bg-accent-soft px-3 py-2 text-[11px] font-medium text-accent">Classwork</button>
        <button type="button" role="tab" aria-selected="false" onClick={() => onNavigate({ screen: 'people', courseId })} className="rounded-lg px-3 py-2 text-[11px] font-medium text-ink-muted hover:bg-accent-soft">People</button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Assignment statistics">
        <MetricCard label="Students enrolled" value={assignment.enrolledCount} />
        <MetricCard label="Submitted" value={`${assignment.submittedCount} submitted`} detail="For this assignment" />
        <MetricCard label="Missing" value={`${assignment.missingCount} missing`} detail="Submission data from Google Classroom" tone="success" />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,704px)_minmax(250px,1fr)]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-3"><h2 className="text-[13px] font-semibold">Student submissions</h2><span className="text-[9px] text-ink-muted">{assignment.submittedCount} submitted · {assignment.missingCount} missing</span></div>
          <div className="space-y-2 p-3">
            {submissions.length === 0 ? <Empty title="No submission records" hint="Classroom has not returned submission details." /> : submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} onOpenEssay={onOpenEssay} />)}
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="space-y-2 p-3">
            <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Assignment materials</h2><span className="text-[9px] text-accent">{assignment.materials.length} materials</span></div>
            <div className="space-y-1.5">{assignment.materials.map((material) => <a key={material.id} href={material.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[10px] hover:text-accent"><span className="flex size-5 items-center justify-center rounded bg-accent-soft text-accent">{material.kind === 'link' ? <Link2 className="size-3" /> : <FileText className="size-3" />}</span><span className="truncate">{material.title}</span><ArrowUpRight className="ml-auto size-3 shrink-0" /></a>)}</div>
            <p className="border-t border-border-subtle pt-2 text-[9px] leading-[13px] text-ink-muted">Opened from the linked Classroom assignment. Materials stay managed in Classroom.</p>
          </Card>
          <Card className="space-y-2 rounded-[12px] bg-accent-soft p-3">
            <h2 className="text-[13px] font-semibold">Essay Check</h2>
            <p className="text-[10px] leading-[14px]">Open a submission to review AI findings and add professor evidence.</p>
            <Button type="button" onClick={() => firstSubmitted && onOpenEssay(firstSubmitted.studentId)} disabled={!firstSubmitted}>Check essays</Button>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SubmissionRow({ submission, onOpenEssay }: { submission: TeacherSubmission; onOpenEssay: (studentId: string) => void }) {
  const canReview = submission.state !== 'missing' && submission.attachments.length > 0
  const tone = submission.state === 'returned' ? 'success' : submission.state === 'submitted' ? 'success' : 'warning'
  return (
    <div className="flex min-h-[98px] flex-col justify-center gap-2 rounded-lg border border-border-subtle bg-canvas p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-[10px] font-semibold">{submission.studentName} · {submission.fileName}</p><p className="mt-2 text-[9px] text-ink-muted">{submission.attachments.length ? `Turned in · ${submission.attachments.length} attachment${submission.attachments.length === 1 ? '' : 's'}` : 'No attachment submitted'}</p><div className="mt-2 flex items-center gap-2"><StatusPill label={submission.state} tone={tone} /><span className="truncate text-[8px] text-ink-muted">{submission.fileName}</span></div></div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end"><span className="text-[8px] text-ink-muted">{submission.submittedAt ? `Submitted ${submission.submittedAt}` : ''}</span>{canReview && <button type="button" onClick={() => onOpenEssay(submission.studentId)} className="text-[9px] font-medium text-accent hover:underline">Open Essay Check →</button>}</div>
    </div>
  )
}
