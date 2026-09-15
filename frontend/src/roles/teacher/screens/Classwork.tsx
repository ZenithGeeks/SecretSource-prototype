import { ArrowLeft, ArrowRight, CalendarDays, Check, FileText, Loader2, Users } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import type { TeacherCourseWork } from '../../../lib/teacher'
import {
  useQueueSelectedCourseWork,
  useSetCourseWorkAnalysisSelected,
  useTeacherClasses,
  useTeacherCourseWork,
} from '../../../lib/useTeacher'

function formatDueDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function canAnalyze(courseWork: TeacherCourseWork) {
  return courseWork.submissions.some(
    (submission) => submission.state === 'TURNED_IN' && submission.attachments.length > 0,
  )
}

export function Classwork({
  courseId,
  onBack,
  onOpenAssignment,
}: {
  courseId: string
  onBack: () => void
  onOpenAssignment: (courseWorkId: string) => void
}) {
  const classes = useTeacherClasses()
  const courseWork = useTeacherCourseWork(courseId)
  const setSelected = useSetCourseWorkAnalysisSelected()
  const queue = useQueueSelectedCourseWork()
  const [queueSummary, setQueueSummary] = useState<string | null>(null)
  const selectedCount = courseWork.data?.filter((item) => item.analysisSelected).length ?? 0
  const course = classes.data?.find((item) => item.id === courseId)

  if (!courseId) {
    return <Empty title="Choose a class" hint="Open a course from Classes to view its classwork." />
  }

  if (classes.isPending || courseWork.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" /> Loading classwork…
      </p>
    )
  }

  if (classes.isError || courseWork.isError) {
    const error = classes.error ?? courseWork.error
    return <Card className="border-refutes text-refutes">Could not load this class: {(error as Error).message}</Card>
  }

  if (!course) {
    return <Empty title="Class not found" hint="This course is no longer available in the connected Classroom account." />
  }

  const handleQueue = async () => {
    setQueueSummary(null)
    try {
      const result = await queue.mutateAsync({ courseId })
      const queuedCount = result.queued.length
      const skippedCount = result.skipped.length
      setQueueSummary(
        `${queuedCount} assignment${queuedCount === 1 ? '' : 's'} queued${skippedCount ? ` · ${skippedCount} skipped because no submitted attachment was available` : ''}.`,
      )
    } catch {
      // The mutation error below stays visible and does not clear the user's selections.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button type="button" variant="ghost" onClick={onBack} className="mb-2 -ml-2 px-2 text-ink-muted">
            <ArrowLeft className="size-4" /> Classes
          </Button>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">{course.name} · Section {course.section}</p>
          <h1 className="mt-1 font-serif text-[22px] font-semibold tracking-tight text-ink">Classwork</h1>
          <p className="mt-1 text-sm text-ink-muted">Select the assignments whose submitted work should enter the analysis queue.</p>
        </div>
        <Button type="button" onClick={handleQueue} disabled={selectedCount === 0 || queue.isPending}>
          {queue.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Analyze selected{selectedCount ? ` (${selectedCount})` : ''}
        </Button>
      </header>

      {queueSummary && <p className="rounded-lg bg-supports-soft px-3 py-2 text-sm text-supports" role="status">{queueSummary}</p>}
      {queue.isError && <p className="text-sm text-refutes" role="alert">Could not queue assignments: {(queue.error as Error).message}</p>}
      {setSelected.isError && <p className="text-sm text-refutes" role="alert">Could not update selection: {(setSelected.error as Error).message}</p>}

      {courseWork.data?.length ? (
        <section aria-label="Google Classroom assignments" className="flex flex-col gap-3">
          {courseWork.data.map((item) => {
            const eligible = canAnalyze(item)
            return (
              <Card key={item.id} className="p-0">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
                  <label className="flex shrink-0 items-start gap-3 pt-1">
                    <input
                      type="checkbox"
                      checked={item.analysisSelected}
                      onChange={(event) => {
                        setQueueSummary(null)
                        setSelected.mutate({ courseId, courseWorkId: item.id, selected: event.target.checked })
                      }}
                      aria-label={`Select ${item.title} for analysis`}
                      className="mt-0.5 size-4 accent-accent"
                    />
                    <span className="sr-only">Select for analysis</span>
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-ink">{item.title}</h2>
                      {item.analysisStatus === 'queued' && (
                        <span className="rounded-full bg-supports-soft px-2.5 py-0.5 text-xs font-medium text-supports">Queued</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-ink-muted">{item.description}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" /> Due {formatDueDate(item.dueAt)}</span>
                      <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" /> {item.materials.length} materials</span>
                      <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" /> {item.submissions.filter((submission) => submission.state === 'TURNED_IN').length} turned in</span>
                    </div>
                    {item.analysisSelected && !eligible && (
                      <p className="mt-2 text-xs text-insufficient">No turned-in submission has an attachment yet; this assignment will be skipped.</p>
                    )}
                  </div>
                  <Button type="button" variant="ghost" onClick={() => onOpenAssignment(item.id)} className="shrink-0 self-start px-2 text-accent">
                    Assignment details <ArrowRight className="size-4" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </section>
      ) : (
        <Empty title="No classwork yet" hint="Assignments and coursework from Google Classroom will appear here." />
      )}
      <p className="text-xs text-ink-muted">Selection and queue status are prototype-only and reset when the page reloads. No changes are sent to Google Classroom.</p>
    </div>
  )
}
