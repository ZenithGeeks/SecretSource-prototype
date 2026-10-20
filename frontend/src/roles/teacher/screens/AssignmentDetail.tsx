import { ArrowUpRight, FileText, Link2 } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherAssignmentDetail, useTeacherWorkspace } from '../../../lib/useTeacher'
import type { TeacherSubmission } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { LoadingState, StatusPill } from '../components/TeacherUi'

export function AssignmentDetail({ courseId, assignmentId, onOpenEssay, onNavigate }: {
  courseId: string
  assignmentId: string
  onOpenEssay: (studentId: string) => void
  onNavigate: (route: TeacherRoute) => void
}) {
  const detail = useTeacherAssignmentDetail(courseId, assignmentId)
  const workspace = useTeacherWorkspace(courseId)
  if (detail.isPending || workspace.isPending) return <LoadingState label="Loading assignment..." />
  if (detail.isError || !detail.data) return <Empty title="Assignment unavailable" hint="Return to Classwork and choose an assignment from Classroom." />

  const { assignment, submissions } = detail.data
  const course = workspace.data
  const firstSubmitted = submissions.find((submission) => submission.state !== 'missing' && submission.attachments.length > 0)
  const stats = [
    { label: 'Students', value: assignment.enrolledCount, detail: 'enrolled' },
    { label: 'Submitted', value: assignment.submittedCount, detail: 'turned in' },
    { label: 'Missing', value: assignment.missingCount, detail: 'not submitted' },
    { label: 'Returned', value: assignment.returnedCount, detail: 'in Classroom' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">{course?.course.name ?? 'Class'} · {course?.course.section ?? ''} / Classwork</p>
          <h1 className="mt-1 font-serif text-[30px] font-semibold leading-9">{assignment.title}</h1>
          <p className="mt-1 text-[12px] text-ink-muted">Due {assignment.dueAt} <span aria-hidden="true">·</span> {assignment.pendingReviewCount} essays to review</p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Assignment summary">
        {stats.map((stat) => <Card key={stat.label} className="px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{stat.label}</p><p className="mt-1 font-serif text-[26px] font-semibold leading-7">{stat.value}</p><p className="mt-1 text-[10px] text-ink-muted">{stat.detail}</p></Card>)}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4"><div><h2 className="text-[13px] font-semibold">Submissions</h2><p className="mt-1 text-[10px] text-ink-muted">{submissions.length} student records from Google Classroom</p></div><button type="button" onClick={() => onNavigate({ screen: 'classwork', courseId })} className="text-[11px] font-medium text-accent hover:underline">All classwork</button></div>
          {submissions.length === 0 ? <div className="p-5"><Empty title="No submission records" hint="Classroom has not returned submission details." /></div> : <div className="divide-y divide-border-subtle">{submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} onOpenEssay={onOpenEssay} />)}</div>}
        </Card>

        <aside className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Assignment materials</h2><span className="text-[10px] text-ink-muted">{assignment.materials.length}</span></div>
            {assignment.materials.length ? <div className="divide-y divide-border-subtle">{assignment.materials.map((material) => <a key={material.id} href={material.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 py-2 text-[11px] hover:text-accent"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink-muted">{material.kind === 'link' ? <Link2 className="size-3.5" /> : <FileText className="size-3.5" />}</span><span className="min-w-0 flex-1 truncate">{material.title}</span><ArrowUpRight className="size-3 shrink-0" /></a>)}</div> : <p className="text-[11px] text-ink-muted">No materials attached.</p>}
            <p className="border-t border-border-subtle pt-3 text-[10px] leading-4 text-ink-muted">Materials stay managed in Google Classroom.</p>
          </Card>
          <Card className="space-y-3 bg-accent-soft/55 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">Review essays</p>
            <p className="text-[11px] leading-5 text-ink-muted">Open a submitted essay to check its claims and source evidence.</p>
            <Button type="button" className="w-full" onClick={() => firstSubmitted && onOpenEssay(firstSubmitted.studentId)} disabled={!firstSubmitted}>Check the evidence</Button>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function SubmissionRow({ submission, onOpenEssay }: { submission: TeacherSubmission; onOpenEssay: (studentId: string) => void }) {
  const canReview = submission.state !== 'missing' && submission.attachments.length > 0
  const tone = submission.state === 'returned' || submission.state === 'submitted' ? 'success' : 'warning'
  return <div className="flex min-h-[68px] items-center gap-3 px-5 py-3 hover:bg-canvas">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{submission.studentName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
    <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{submission.studentName}</p><p className="mt-1 truncate text-[10px] text-ink-muted">{submission.attachments.length ? `${submission.fileName} · ${submission.attachments.length} attachment${submission.attachments.length === 1 ? '' : 's'}` : 'No attachment submitted'}</p></div>
    <StatusPill label={submission.state} tone={tone} />
    {canReview && <button type="button" onClick={() => onOpenEssay(submission.studentId)} className="shrink-0 text-[10px] font-medium text-accent hover:underline">Review</button>}
  </div>
}
