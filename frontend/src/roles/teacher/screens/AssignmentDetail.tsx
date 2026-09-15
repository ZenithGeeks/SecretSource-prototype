import { ArrowLeft, ExternalLink, FileText, Link as LinkIcon, Loader2, Video } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import type { ClassroomMaterial, TeacherCourseWork } from '../../../lib/teacher'
import { useTeacherClasses, useTeacherCourseWork } from '../../../lib/useTeacher'

function MaterialIcon({ material }: { material: ClassroomMaterial }) {
  if (material.kind === 'youtubeVideo') return <Video className="mt-0.5 size-4 shrink-0 text-ink-muted" />
  if (material.kind === 'link') return <LinkIcon className="mt-0.5 size-4 shrink-0 text-ink-muted" />
  return <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" />
}

function formatTimestamp(value?: string) {
  if (!value) return 'No submission time recorded'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AssignmentDetail({
  courseId,
  courseWorkId,
  onBack,
  onOpenEssay,
}: {
  courseId: string
  courseWorkId: string
  onBack: () => void
  onOpenEssay: (studentId: string) => void
}) {
  const classes = useTeacherClasses()
  const courseWork = useTeacherCourseWork(courseId)

  if (!courseId || !courseWorkId) {
    return <Empty title="Assignment not selected" hint="Choose an assignment from a classwork page to see its materials and submissions." />
  }

  if (classes.isPending || courseWork.isPending) {
    return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Loading assignment…</p>
  }

  if (classes.isError || courseWork.isError) {
    const error = classes.error ?? courseWork.error
    return <Card className="border-refutes text-refutes">Could not load assignment: {(error as Error).message}</Card>
  }

  const course = classes.data?.find((item) => item.id === courseId)
  const assignment: TeacherCourseWork | undefined = courseWork.data?.find((item) => item.id === courseWorkId)
  if (!course || !assignment) {
    return <Empty title="Assignment not found" hint="This assignment is no longer available in the connected Classroom account." />
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Button type="button" variant="ghost" onClick={onBack} className="mb-2 -ml-2 px-2 text-ink-muted">
          <ArrowLeft className="size-4" /> {course.name} classwork
        </Button>
        <p className="text-xs font-medium uppercase tracking-wide text-accent">{course.name} · Section {course.section}</p>
        <h1 className="mt-1 font-serif text-[22px] font-semibold tracking-tight text-ink">{assignment.title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-5 text-ink-muted">{assignment.description}</p>
        <p className="mt-2 text-xs text-ink-muted">Due {formatTimestamp(assignment.dueAt)}</p>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold text-ink">Teacher materials</h2>
            <span className="text-xs text-ink-muted">From Classroom</span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Reference materials attached to this assignment.</p>
          {assignment.materials.length ? (
            <ul className="mt-4 flex flex-col divide-y divide-border-subtle">
              {assignment.materials.map((material) => (
                <li key={material.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <MaterialIcon material={material} />
                  <div className="min-w-0 flex-1">
                    <a href={material.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent underline-offset-2 hover:underline">
                      {material.title}
                    </a>
                    <p className="mt-1 text-xs text-ink-muted">{material.description ?? material.kind}</p>
                  </div>
                  <ExternalLink className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4"><Empty title="No materials attached" hint="This Classroom assignment has no teacher-provided materials." /></div>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg font-semibold text-ink">Student submissions</h2>
            <span className="text-xs text-ink-muted">{assignment.submissions.length} submissions</span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Open an attached submission in Classroom or review its claims in SecretSource.</p>
          {assignment.submissions.length ? (
            <ul className="mt-4 flex flex-col divide-y divide-border-subtle">
              {assignment.submissions.map((submission) => {
                const canReview = submission.state === 'TURNED_IN' && submission.attachments.length > 0
                return (
                  <li key={submission.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{submission.studentName}</p>
                        <p className="mt-1 text-xs text-ink-muted">{submission.state.replaceAll('_', ' ').toLowerCase()} · {formatTimestamp(submission.submittedAt)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={submission.alternateLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-accent-soft hover:text-ink">
                          Classroom <ExternalLink className="size-3.5" />
                        </a>
                        <Button type="button" variant="ghost" disabled={!canReview} onClick={() => onOpenEssay(submission.studentId)} className="px-2 text-xs text-accent">
                          Check essay
                        </Button>
                      </div>
                    </div>
                    {submission.attachments.length ? (
                      <ul className="mt-3 flex flex-col gap-2">
                        {submission.attachments.map((attachment) => (
                          <li key={attachment.id} className="flex items-start gap-2 rounded-lg bg-canvas px-3 py-2">
                            <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                            <div className="min-w-0 flex-1">
                              <a href={attachment.url} target="_blank" rel="noreferrer" className="break-all text-sm text-accent underline-offset-2 hover:underline">
                                {attachment.title}
                              </a>
                              <p className="mt-0.5 break-all text-[11px] text-ink-muted">{attachment.mimeType}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs text-ink-muted">No attachment is available for this submission.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="mt-4"><Empty title="No submissions yet" hint="Student work returned by Classroom will appear here." /></div>
          )}
        </Card>
      </div>
    </div>
  )
}
