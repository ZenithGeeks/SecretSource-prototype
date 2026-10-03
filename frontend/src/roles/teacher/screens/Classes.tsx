import { GraduationCap, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, Input } from '../../../components/ui'
import { filterTeacherClasses } from '../../../lib/teacherSelectors'
import { useTeacherClasses, useTeacherGoogleConnection } from '../../../lib/useTeacher'
import type { TeacherClass } from '../../../lib/teacher'
import { Breadcrumbs, LoadingState, StatusPill } from '../components/TeacherUi'
import { AddClass } from './AddClass'

export function Classes({ onOpenClass, onOpenHome, onAddClass, onConnectGoogle, connectionError }: {
  onOpenClass: (courseId: string) => void
  onOpenHome?: () => void
  onAddClass: () => void
  onConnectGoogle: () => void
  connectionError?: string
}) {
  const connection = useTeacherGoogleConnection()
  const classes = useTeacherClasses()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTeacherClasses(classes.data ?? [], query), [classes.data, query])

  if (classes.isPending) return <LoadingState label="Loading classes..." />
  if (classes.isError) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: 'Teacher workspace', onClick: onOpenHome }, { label: 'Classes' }]} />
        <Empty title="Classes could not load" hint="Try refreshing the page to load your Classroom courses." />
        <Button type="button" onClick={() => void classes.refetch()}>Retry</Button>
      </div>
    )
  }
  if (!classes.data?.length && connection.isPending) return <LoadingState label="Checking Google Classroom connection..." />
  if (!classes.data?.length && connection.isError) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: 'Teacher workspace', onClick: onOpenHome }, { label: 'Classes' }]} />
        <Empty title="Google Classroom connection could not be checked" hint="The SecretSource API did not respond. Check that it is reachable, then try again." />
        <Button type="button" onClick={() => void connection.refetch()}>Retry</Button>
      </div>
    )
  }
  if (!classes.data?.length && !connection.data?.connected) {
    return <AddClass step="connect" error={connectionError} onBack={() => undefined} onContinue={onConnectGoogle} onSelectCourse={() => undefined} onImport={() => undefined} />
  }

  return (
    <div className="space-y-7">
      <Breadcrumbs items={[{ label: 'Teacher workspace', onClick: onOpenHome }, { label: 'Classes' }]} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-[34px] font-semibold leading-[40px] text-ink">Classes</h1>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">Your Google Classroom courses, mirrored in SecretSource.</p>
        </div>
        <Button type="button" onClick={onAddClass}><Plus className="size-4" />Add class</Button>
      </header>

      <section className="space-y-3" aria-labelledby="active-classes-heading">
        <p id="active-classes-heading" className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Active classes</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block w-full sm:max-w-[460px]">
            <span className="sr-only">Search classes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your Classroom courses" className="h-[42px] rounded-lg pl-9 text-[12px]" />
          </label>
          <p className="text-[10px] text-ink-muted">{filtered.length} active {filtered.length === 1 ? 'course' : 'courses'}</p>
        </div>

        {filtered.length === 0 ? (
          <Empty title="No matching classes" hint="Try another search term or add a class from Classroom." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filtered.map((course) => <CourseCard key={course.id} course={course} onOpen={() => onOpenClass(course.id)} />)}
          </div>
        )}
      </section>

      <Card className="flex min-h-[67px] items-center gap-3 rounded-[10px] bg-accent-soft px-4 py-3">
        <GraduationCap className="size-[18px] shrink-0 text-accent" />
        <p className="text-[11px] leading-4 text-ink">Add class connects a course you already teach. Courses are imported from Classroom; SecretSource does not create a new Classroom course.</p>
      </Card>
    </div>
  )
}

function CourseCard({ course, onOpen }: { course: TeacherClass; onOpen: () => void }) {
  return (
    <Card className="flex min-h-[248px] flex-col gap-2.5 rounded-[12px] p-[17px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-[16px] font-semibold leading-[22px]">{course.name} · {course.section}</h2>
        <StatusPill label="Active" tone="success" />
      </div>
      <p className="text-[11px] leading-[15px] text-ink-muted">Section {course.section} · Google Classroom</p>
      <div className="grid grid-cols-3 gap-2 py-1 text-[11px] font-medium text-ink-muted">
        <span>{course.studentCount} students</span>
        <span>{course.assignmentCount} assignments</span>
        <span>1 teacher</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border-subtle pt-2.5">
        <p className="text-[10px] text-ink-muted">Synced {course.lastSyncedAt}</p>
        <Button type="button" variant="ghost" className="px-3 py-2 text-[14px] font-medium text-ink-muted" onClick={onOpen}>Open class</Button>
      </div>
    </Card>
  )
}
