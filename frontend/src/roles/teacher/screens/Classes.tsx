import { BookOpen, CalendarDays, ChevronRight, FileStack, Plus, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, Input } from '../../../components/ui'
import { filterTeacherClasses } from '../../../lib/teacherSelectors'
import { useTeacherClasses } from '../../../lib/useTeacher'
import { InitialAvatar, LoadingState, PageHeading, StatusPill } from '../components/TeacherUi'

export function Classes({ onOpenClass, onAddClass }: {
  onOpenClass: (courseId: string) => void
  onAddClass: () => void
}) {
  const classes = useTeacherClasses()
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => filterTeacherClasses(classes.data ?? [], query),
    [classes.data, query],
  )

  if (classes.isPending) return <LoadingState label="Loading classes..." />
  if (classes.isError) return <Empty title="Classes could not load" hint="Try refreshing the page to load your local class data." />

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Teacher workspace"
        title="Classes"
        description="Keep your teaching spaces together, then open a class to review its work and people."
        actions={(
          <Button type="button" onClick={onAddClass}>
            <Plus className="size-4" />
            Add class
          </Button>
        )}
      />

      <section className="space-y-4" aria-labelledby="active-classes-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p id="active-classes-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Active classes</p>
            <p className="mt-1 text-sm text-ink-muted">{filtered.length} of {classes.data?.length ?? 0} classes</p>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Search classes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search classes" className="pl-9" />
          </label>
        </div>

        {filtered.length === 0 ? (
          <Empty title="No matching classes" hint="Try another search term or add a class from Classroom." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filtered.map((course) => (
              <Card key={course.id} className="flex flex-col gap-5 p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <InitialAvatar initials={course.section} className="size-11 rounded-xl" />
                    <div className="min-w-0">
                      <h2 className="truncate font-serif text-xl font-semibold text-ink">{course.name}</h2>
                      <p className="mt-1 text-sm text-ink-muted">Section {course.section} · {course.subject}</p>
                    </div>
                  </div>
                  <StatusPill label="Active" tone="success" />
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-lg bg-canvas p-3 text-xs text-ink-muted sm:grid-cols-4">
                  <span className="flex items-center gap-1.5"><Users className="size-3.5 text-accent" />{course.studentCount} students</span>
                  <span className="flex items-center gap-1.5"><FileStack className="size-3.5 text-accent" />{course.assignmentCount} classwork</span>
                  <span className="flex items-center gap-1.5"><BookOpen className="size-3.5 text-accent" />{course.linkedFileCount} files</span>
                  <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-accent" />Synced {course.lastSyncedAt}</span>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
                  <p className="text-xs text-ink-muted">{course.topicCount} topics · {course.announcementCount} announcements</p>
                  <button type="button" onClick={() => onOpenClass(course.id)} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
                    Open class <ChevronRight className="size-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card className="flex flex-col gap-3 bg-accent-soft/45 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-ink">Classroom connection</p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">Class details are shown in read-only mode in this frontend prototype. Importing a class only updates this local session.</p>
        </div>
        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-accent">Read-only</span>
      </Card>
    </div>
  )
}
