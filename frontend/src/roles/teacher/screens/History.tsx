import { FileText, History as HistoryIcon } from 'lucide-react'

import { Empty } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import { useTeacherHistory } from '../../../lib/useTeacher'
import type { TeacherHistoryEntry } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { LoadingState, PageHeading } from '../components/TeacherUi'

function activityLabel(entry: TeacherHistoryEntry) {
  return [
    entry.activity.includes('analysis') ? 'Analysis' : null,
    entry.activity.includes('professor-review') ? 'Teacher decision' : null,
    entry.activity.includes('feedback') ? 'Feedback' : null,
  ].filter(Boolean).join(' · ')
}

function formattedDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Recently checked'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function TeacherHistoryList({ selected, onSelect }: {
  selected: Pick<TeacherRoute, 'courseId' | 'assignmentId' | 'studentId'>
  onSelect: (entry: TeacherHistoryEntry) => void
}) {
  const history = useTeacherHistory()

  if (history.isPending) return <LoadingState label="Loading checked work..." />
  if (history.isError) {
    return <p role="alert" className="px-3 text-sm text-refutes">Recent checked work could not be loaded.</p>
  }
  if (!history.data?.length) return <p className="px-3 text-sm text-ink-muted">No checked work yet.</p>

  return (
    <nav aria-label="Recent checked work" className="space-y-1">
      {history.data.map((entry) => {
        const active = entry.courseId === selected.courseId
          && entry.assignmentId === selected.assignmentId
          && entry.studentId === selected.studentId
        return (
          <button
            key={entry.id}
            type="button"
            data-closes-menu
            onClick={() => onSelect(entry)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-16 w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
              active ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:bg-accent-soft hover:text-ink',
            )}
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{entry.studentName}</span>
              <span className="mt-0.5 block truncate text-xs">{entry.assignmentTitle} · {entry.courseName}</span>
              <span className="mt-0.5 block truncate text-[11px]">{entry.fileName}</span>
              <span className="mt-1 block truncate text-[11px]">{activityLabel(entry)}</span>
              <span className="mt-0.5 block truncate text-[11px]">{formattedDate(entry.checkedAt)}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export function TeacherHistoryPage({ onSelect }: {
  onSelect: (entry: TeacherHistoryEntry) => void
}) {
  const history = useTeacherHistory()

  return (
    <div className="space-y-7">
      <PageHeading
        eyebrow="Teacher"
        title="History"
        description="Recent student work you have checked, including completed analyses, saved decisions, and feedback."
      />
      <section aria-labelledby="teacher-history-recent-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-accent" />
          <h2 id="teacher-history-recent-heading" className="text-sm font-semibold text-ink">Recent checked work</h2>
        </div>
        {history.data?.length === 50 && (
          <p className="text-xs text-ink-muted">Showing the newest 50 entries.</p>
        )}
        {history.isPending ? (
          <LoadingState label="Loading checked work..." />
        ) : history.isError ? (
          <p role="alert" className="text-sm text-refutes">Recent checked work could not be loaded.</p>
        ) : history.data?.length ? (
          <nav aria-label="Recent checked work" className="grid gap-2 xl:grid-cols-2">
            {history.data.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry)}
                className="flex min-h-20 items-start gap-3 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{entry.studentName}</span>
                  <span className="mt-1 block truncate text-xs text-ink-muted">{entry.assignmentTitle} · {entry.courseName}</span>
                  <span className="mt-1 block truncate text-xs text-ink-muted">{entry.fileName}</span>
                  <span className="mt-2 block text-xs text-ink-muted">{activityLabel(entry)} · {formattedDate(entry.checkedAt)}</span>
                </span>
              </button>
            ))}
          </nav>
        ) : (
          <Empty
            title="No checked work yet"
            hint="Completed analyses, saved decisions, and feedback will appear here."
          />
        )}
      </section>
    </div>
  )
}
