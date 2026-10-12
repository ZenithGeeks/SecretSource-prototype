import { ChevronRight } from 'lucide-react'

import { useTeacherClasses, useTeacherHistory } from '../../../lib/useTeacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'

export function TeacherSidebar({ onOpen }: { onOpen: (route: TeacherRoute) => void }) {
  const classes = useTeacherClasses()
  const history = useTeacherHistory()

  return (
    <div className="mt-5 space-y-5">
      <section aria-labelledby="teacher-sidebar-classes">
        <h2 id="teacher-sidebar-classes" className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Your classes</h2>
        {classes.data?.length ? (
          <nav aria-label="Your classes" className="space-y-0.5">
            {classes.data.map((course) => (
              <button
                key={course.id}
                type="button"
                data-closes-menu
                onClick={() => onOpen({ screen: 'class-overview', courseId: course.id })}
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{course.name}{course.section ? ` · ${course.section}` : ''}</span>
                <span className="shrink-0 text-[10px] text-ink-muted">{course.studentCount}</span>
              </button>
            ))}
          </nav>
        ) : classes.isPending ? (
          <p className="px-2 text-[11px] text-ink-muted">Loading classes…</p>
        ) : (
          <p className="px-2 text-[11px] text-ink-muted">No classes yet</p>
        )}
      </section>

      <section aria-labelledby="teacher-sidebar-recent">
        <h2 id="teacher-sidebar-recent" className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Recently viewed</h2>
        {history.data?.length ? (
          <nav aria-label="Recently viewed" className="space-y-0.5">
            {history.data.slice(0, 3).map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-closes-menu
                onClick={() => onOpen({
                  screen: 'essay-check',
                  courseId: entry.courseId,
                  assignmentId: entry.assignmentId,
                  studentId: entry.studentId,
                })}
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.studentName} · {entry.assignmentTitle}</span>
                </span>
                <span className="shrink-0 text-[10px] text-ink-muted">{relativeDay(entry.checkedAt)}</span>
                <ChevronRight className="size-3 shrink-0 text-ink-muted" />
              </button>
            ))}
          </nav>
        ) : history.isPending ? (
          <p className="px-2 text-[11px] text-ink-muted">Loading recent work…</p>
        ) : history.isError ? (
          <p className="px-2 text-[11px] text-ink-muted">Recent work is unavailable</p>
        ) : (
          <p className="px-2 text-[11px] text-ink-muted">No recent work yet</p>
        )}
        {history.data && history.data.length > 3 && (
          <button
            type="button"
            data-closes-menu
            onClick={() => onOpen({ screen: 'history' })}
            className="mt-1 px-2 text-[10px] font-medium text-accent hover:underline"
          >
            View all recently checked
          </button>
        )}
      </section>
    </div>
  )
}

function relativeDay(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Recent'
  const today = new Date()
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf()
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).valueOf()
  const days = Math.round((todayDay - dateDay) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
}
