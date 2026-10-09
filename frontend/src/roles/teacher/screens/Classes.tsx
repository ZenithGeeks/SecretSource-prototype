import { ChevronRight, GraduationCap, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, Input } from '../../../components/ui'
import { filterTeacherClasses } from '../../../lib/teacherSelectors'
import { useTeacherClasses, useTeacherGoogleConnection, useTeacherHome } from '../../../lib/useTeacher'
import type { TeacherClass } from '../../../lib/teacher'
import { LoadingState, StatusPill } from '../components/TeacherUi'
import { AddClass } from './AddClass'

export function Classes({ onOpenClass, onConnectGoogle, connectionError }: {
  onOpenClass: (courseId: string) => void
  onOpenHome?: () => void
  onConnectGoogle: () => void
  connectionError?: string
}) {
  const connection = useTeacherGoogleConnection()
  const classes = useTeacherClasses()
  const home = useTeacherHome()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTeacherClasses(classes.data ?? [], query), [classes.data, query])

  if (classes.isPending) return <LoadingState label="Loading classes..." />
  if (classes.isError) {
    return <Empty title="Classes could not load" hint="The teacher data service could not retrieve your Classroom courses." />
  }
  if (!classes.data?.length && connection.isPending) return <LoadingState label="Checking Google Classroom connection..." />
  if (!classes.data?.length && connection.isError) {
    return <div className="space-y-4"><Empty title="Google Classroom connection could not be checked" hint="The SecretSource API did not respond. Check that it is reachable, then try again." /><Button type="button" onClick={() => void connection.refetch()}>Retry</Button></div>
  }
  if (!classes.data?.length && !connection.data?.connected) {
    return <AddClass step="connect" error={connectionError} onBack={() => undefined} onContinue={onConnectGoogle} onSelectCourse={() => undefined} onImport={() => undefined} />
  }

  const submissions = home.data?.submissions ?? []
  const pendingByCourse = new Map<string, number>()
  for (const submission of submissions) {
    if (submission.state === 'submitted' && submission.reviewStatus !== 'analysis-ready' && submission.courseId) {
      pendingByCourse.set(submission.courseId, (pendingByCourse.get(submission.courseId) ?? 0) + 1)
    }
  }

  return (
    <div className="space-y-7">
      {connectionError && <p role="alert" className="text-sm text-refutes">{connectionError}</p>}
      {connection.isError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3"><p className="text-sm text-ink-muted">Google Classroom connection status could not be checked.</p><Button type="button" variant="ghost" onClick={() => void connection.refetch()}>Retry</Button></div>}
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">{classes.data.length} active classes · from Google Classroom</p>
        <h1 className="font-serif text-[34px] font-semibold leading-[40px] text-ink">Classes</h1>
      </header>

      <section aria-label="Class list" className="space-y-5">
        <label className="relative block w-full sm:max-w-[300px]">
          <span className="sr-only">Search classes</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search classes" className="h-[36px] rounded-lg pl-9 text-[11px]" />
        </label>
        {filtered.length === 0 ? <Empty title="No matching classes" hint="Try another search term or add a class from Google Classroom." /> : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((course) => <CourseCard key={course.id} course={course} pendingReviews={pendingByCourse.get(course.id) ?? 0} onOpen={() => onOpenClass(course.id)} />)}
          </div>
        )}
      </section>

      <Card className="flex min-h-[46px] items-center gap-3 rounded-lg bg-accent-soft/55 px-4 py-3">
        <GraduationCap className="size-4 shrink-0 text-accent" />
        <p className="text-[11px] leading-4 text-ink-muted"><span className="mr-2 rounded-full bg-accent-soft px-2 py-1 text-[9px] font-medium text-accent">Add class</span>Add class connects a course you already teach. Courses are imported from Classroom; SecretSource does not create a new Classroom course.</p>
      </Card>
    </div>
  )
}

function CourseCard({ course, pendingReviews, onOpen }: { course: TeacherClass; pendingReviews: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex min-h-[184px] w-full flex-col rounded-[14px] border border-border-subtle bg-surface p-4 text-left shadow-[0_5px_18px_rgba(35,24,38,0.05)] transition hover:-translate-y-0.5 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <div className="flex w-full items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">
        <span>{course.section}</span><ChevronRight className="size-3.5 text-ink-muted transition group-hover:translate-x-0.5" />
      </div>
      <h2 className="mt-3 font-serif text-[21px] font-semibold leading-[26px] text-ink">{course.name}</h2>
      <p className="mt-2 text-[11px] text-ink-muted">{course.studentCount} students · {course.assignmentCount} {course.assignmentCount === 1 ? 'assignment' : 'assignments'}</p>
      <div className="mt-auto border-t border-border-subtle pt-3">
        <StatusPill label={pendingReviews ? `${pendingReviews} ${pendingReviews === 1 ? 'essay' : 'essays'} to review` : 'Up to date'} tone={pendingReviews ? 'danger' : 'success'} />
      </div>
    </button>
  )
}
