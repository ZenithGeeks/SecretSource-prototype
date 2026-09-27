import { FileText, Loader2 } from 'lucide-react'

import { useTeacherAssignmentDetail } from '../../../lib/useTeacher'

/** Assignment-scoped student navigation shown in the teacher shell during Essay Check. */
export function EssayCheckRoster({ courseId, assignmentId, selectedStudentId, onSelect }: {
  courseId: string
  assignmentId: string
  selectedStudentId: string
  onSelect: (studentId: string) => void
}) {
  const detail = useTeacherAssignmentDetail(courseId, assignmentId)

  return (
    <section aria-labelledby="essay-check-students" className="mt-3 border-t border-border-subtle pt-4">
      <h2 id="essay-check-students" className="px-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Students</h2>
      {detail.isPending ? (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-ink-muted"><Loader2 className="size-3.5 animate-spin" />Loading students…</p>
      ) : detail.isError || !detail.data ? (
        <p className="px-3 py-4 text-xs text-ink-muted">Student list unavailable.</p>
      ) : (
        <nav aria-label="Assignment students" className="mt-2 flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
          {detail.data.submissions.filter((submission) => submission.state !== 'missing').map((submission) => (
            <button
              key={submission.studentId}
              type="button"
              data-closes-menu
              aria-current={submission.studentId === selectedStudentId ? 'page' : undefined}
              onClick={() => onSelect(submission.studentId)}
              className={submission.studentId === selectedStudentId
                ? 'flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-left text-sm font-medium text-ink'
                : 'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-ink-muted hover:bg-accent-soft hover:text-ink'}
            >
              <FileText className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{submission.studentName}</span>
              <span className="max-w-20 truncate text-[10px] text-ink-muted">{submission.fileName}</span>
            </button>
          ))}
        </nav>
      )}
    </section>
  )
}
