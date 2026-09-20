import { ArrowUpRight, ChevronRight, FileText, Link2, Users } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherAssignmentDetail, useTeacherWorkspace } from '../../../lib/useTeacher'
import type { TeacherSubmission } from '../../../lib/teacher'
import { Breadcrumbs, LoadingState, MetricCard, PageHeading, StatusPill } from '../components/TeacherUi'

export function AssignmentDetail({ courseId, assignmentId, onOpenEssay }: {
  courseId: string
  assignmentId: string
  onOpenEssay: (studentId: string) => void
}) {
  const detail = useTeacherAssignmentDetail(courseId, assignmentId)
  const workspace = useTeacherWorkspace(courseId)
  if (detail.isPending || workspace.isPending) return <LoadingState label="Loading assignment..." />
  if (detail.isError || !detail.data) return <Empty title="Assignment unavailable" hint="Return to Classwork and choose an assignment from the local class view." />

  const { assignment, submissions } = detail.data
  const courseName = workspace.data?.course.name ?? 'Class'
  return (
    <div className="space-y-7">
      <Breadcrumbs items={[{ label: 'Classes' }, { label: courseName }, { label: 'Classwork' }, { label: assignment.title }]} />
      <PageHeading
        title={assignment.title}
        description={`Due ${assignment.dueAt} · ${assignment.materials.length} materials attached`}
        actions={<StatusPill label={assignment.status === 'not-started' ? 'Not started' : assignment.status} tone={assignment.status === 'returned' ? 'success' : assignment.status === 'pending' ? 'warning' : 'neutral'} />}
      />
      <div role="tablist" aria-label="Assignment context" className="flex gap-5 border-b border-border-subtle"><a role="tab" aria-selected="true" href={`?role=teacher&screen=assignment-detail&courseId=${encodeURIComponent(courseId)}&assignmentId=${encodeURIComponent(assignmentId)}`} className="border-b-2 border-accent pb-3 text-sm font-semibold text-accent">Classwork</a><a role="tab" aria-selected="false" href={`?role=teacher&screen=people&courseId=${encodeURIComponent(courseId)}`} className="pb-3 text-sm font-medium text-ink-muted hover:text-accent">People</a></div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Enrolled" value={assignment.enrolledCount} detail="students" />
        <MetricCard label="Submitted" value={assignment.submittedCount} detail={`${assignment.pendingReviewCount} ready for Essay Check`} tone="accent" />
        <MetricCard label="Missing" value={assignment.missingCount} detail="students" tone="danger" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle p-5"><div><h2 className="font-serif text-xl font-semibold">Submissions</h2><p className="mt-1 text-sm text-ink-muted">Showing the local submission sample for this assignment.</p></div><Users className="size-5 text-accent" /></div>
          <div className="divide-y divide-border-subtle">
            {submissions.length === 0 ? <div className="p-5"><Empty title="No submission records" hint="This assignment does not have local submission details yet." /></div> : submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} onOpenEssay={onOpenEssay} />)}
          </div>
          <p className="border-t border-border-subtle px-5 py-4 text-xs text-ink-muted">{submissions.length} local records · {assignment.enrolledCount} enrolled</p>
        </Card>

        <Card>
          <div className="flex items-center gap-2"><FileText className="size-5 text-accent" /><h2 className="font-serif text-xl font-semibold">Assignment materials</h2></div>
          <div className="mt-5 space-y-3">
            {assignment.materials.length === 0 ? <p className="text-sm text-ink-muted">No materials attached.</p> : assignment.materials.map((material) => <a key={material.id} href={material.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 rounded-lg border border-border-subtle p-3 hover:border-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">{material.kind === 'link' ? <Link2 className="size-4" /> : <FileText className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{material.title}</span><span className="mt-1 block text-xs text-ink-muted">{material.kind === 'link' ? 'Open linked paper' : 'Open Drive file'}</span></span><ArrowUpRight className="size-4 shrink-0 text-ink-muted" /></a>)}
          </div>
        </Card>
      </div>

      <Card className="flex flex-col gap-4 border-accent bg-accent-soft/30 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">Essay Check</p><h2 className="mt-1 font-serif text-xl font-semibold">Review the evidence in submitted essays</h2><p className="mt-1 text-sm text-ink-muted">Open a submitted file to inspect citations and prepare feedback.</p></div>
        <Button type="button" onClick={() => { const first = submissions.find((submission) => submission.state !== 'missing' && submission.attachments.length > 0); if (first) onOpenEssay(first.studentId) }} disabled={!submissions.some((submission) => submission.state !== 'missing' && submission.attachments.length > 0)}>Open Essay Check <ChevronRight className="size-4" /></Button>
      </Card>
    </div>
  )
}

function SubmissionRow({ submission, onOpenEssay }: { submission: TeacherSubmission; onOpenEssay: (studentId: string) => void }) {
  const canReview = submission.state !== 'missing' && submission.attachments.length > 0
  const tone = submission.state === 'returned' ? 'success' : submission.state === 'submitted' ? 'accent' : 'danger'
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{submission.studentName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{submission.studentName}</p><p className="mt-1 truncate text-xs text-ink-muted">{submission.fileName}{submission.submittedAt ? ` · ${submission.submittedAt}` : ''}</p></div></div>
      <div className="flex items-center gap-2"><StatusPill label={submission.state} tone={tone} />{canReview && <Button type="button" variant="ghost" onClick={() => onOpenEssay(submission.studentId)}>Check essay <ChevronRight className="size-4" /></Button>}</div>
    </div>
  )
}
