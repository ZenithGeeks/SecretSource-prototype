import { ArrowRight, GraduationCap, Loader2, Users } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherClasses } from '../../../lib/useTeacher'
import type { TeacherCourse } from '../../../lib/teacher'

export function Classes({ onOpenCourse }: { onOpenCourse: (course: TeacherCourse) => void }) {
  const classes = useTeacherClasses()

  if (classes.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" /> Loading your Google Classroom courses…
      </p>
    )
  }

  if (classes.isError) {
    return <Card className="border-refutes text-refutes">Could not load classes: {(classes.error as Error).message}</Card>
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-accent">
          <GraduationCap className="size-4" /> Google Classroom
        </p>
        <h1 className="mt-1 font-serif text-[22px] font-semibold tracking-tight text-ink">Your classes</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Courses and classwork are read from Classroom. Choose a class to review its assignments.
        </p>
      </header>

      {classes.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {classes.data.map((course) => (
            <Card key={course.id} className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-lg font-semibold text-ink">{course.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">Section {course.section} · {course.room}</p>
                </div>
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">Active</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <Users className="size-4" /> {course.studentCount} students
              </div>
              <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                <span className="text-xs text-ink-muted">Teacher · {course.teacher}</span>
                <Button type="button" variant="ghost" onClick={() => onOpenCourse(course)} className="px-2 text-accent">
                  Open class <ArrowRight className="size-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty title="No Classroom courses" hint="Courses shared with your teacher account will appear here." />
      )}
    </div>
  )
}
