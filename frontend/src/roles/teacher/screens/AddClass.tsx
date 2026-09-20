import { BookOpen, Check, ChevronLeft, Cloud, FileText, HardDrive, Search, ShieldCheck, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, Input } from '../../../components/ui'
import { useTeacherClassImportPreview, useTeacherImportableClasses } from '../../../lib/useTeacher'
import type { TeacherClass } from '../../../lib/teacher'
import { Breadcrumbs, InitialAvatar, LoadingState, PageHeading, StatusPill, StepProgress } from '../components/TeacherUi'

export type AddClassStep = 'connect' | 'course' | 'review'

export function AddClass({
  step,
  selectedCourseId,
  onBack,
  onContinue,
  onSelectCourse,
  onImport,
}: {
  step: AddClassStep
  selectedCourseId?: string
  onBack: () => void
  onContinue: () => void
  onSelectCourse: (courseId: string) => void
  onImport: (courseId: string) => void
}) {
  const steps = ['Connect Google', 'Choose a course', 'Review import']
  return (
    <div className="space-y-8">
      <Breadcrumbs items={[{ label: 'Classes', onClick: onBack }, { label: 'Add class' }]} />
      <StepProgress steps={steps} active={step === 'connect' ? 0 : step === 'course' ? 1 : 2} />
      {step === 'connect' ? (
        <ConnectStep onContinue={onContinue} />
      ) : step === 'course' ? (
        <CourseStep selectedCourseId={selectedCourseId} onBack={onBack} onContinue={onContinue} onSelectCourse={onSelectCourse} />
      ) : (
        <ReviewStep courseId={selectedCourseId ?? ''} onBack={onBack} onImport={onImport} />
      )}
    </div>
  )
}

function ConnectStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-7">
      <PageHeading
        title="Connect Google Classroom"
        description="Choose the Google account that owns the classes you want to bring into SecretSource."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <AccessCard icon={Cloud} title="Google Classroom" detail="Course names, classwork, due dates, and submission status" />
        <AccessCard icon={HardDrive} title="Google Drive" detail="Files attached to the selected course and its classwork" />
      </div>
      <Card className="flex gap-3 bg-accent-soft/45">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
        <div>
          <p className="font-medium">Read-only access</p>
          <p className="mt-1 text-sm leading-6 text-ink-muted">This prototype does not request access or make changes to Google. Continue only previews the local import flow.</p>
        </div>
      </Card>
      <div className="flex justify-end">
        <Button type="button" onClick={onContinue}>Continue with Google</Button>
      </div>
    </div>
  )
}

function AccessCard({ icon: Icon, title, detail }: { icon: typeof Cloud; title: string; detail: string }) {
  return (
    <Card className="space-y-4">
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon className="size-5" /></span>
      <div>
        <h2 className="font-serif text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">{detail}</p>
      </div>
      <StatusPill label="Read-only" tone="accent" />
    </Card>
  )
}

function CourseStep({
  selectedCourseId,
  onBack,
  onContinue,
  onSelectCourse,
}: {
  selectedCourseId?: string
  onBack: () => void
  onContinue: () => void
  onSelectCourse: (courseId: string) => void
}) {
  const courses = useTeacherImportableClasses()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (courses.data ?? []).filter((course) =>
      !needle || [course.name, course.section, course.subject].some((value) => value.toLocaleLowerCase().includes(needle)),
    )
  }, [courses.data, query])
  const selected = courses.data?.find((course) => course.id === selectedCourseId)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-7">
      <PageHeading title="Choose a course" description="Select one course to preview the class data that will be available in this session." />
      <label className="relative block max-w-md">
        <span className="sr-only">Search courses</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" className="pl-9" />
      </label>
      {courses.isPending ? <LoadingState label="Loading available courses..." /> : courses.isError ? (
        <Empty title="Courses could not load" hint="Return to Classes and try the local flow again." />
      ) : filtered.length === 0 ? (
        <Empty title="No matching courses" hint="Try searching by course name or section." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((course) => <CourseChoice key={course.id} course={course} selected={course.id === selectedCourseId} onSelect={onSelectCourse} />)}
        </div>
      )}
      {selected && (
        <Card className="border-accent bg-accent-soft/35">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">Selected course</p>
              <p className="mt-1 font-serif text-xl font-semibold">{selected.name} · {selected.section}</p>
              <p className="mt-1 text-sm text-ink-muted">{selected.studentCount} students · {selected.assignmentCount} classwork items</p>
            </div>
            <StatusPill label="Read-only" tone="accent" />
          </div>
        </Card>
      )}
      <div className="flex justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}><ChevronLeft className="size-4" />Back</Button>
        <Button type="button" onClick={onContinue} disabled={!selectedCourseId}>Review import</Button>
      </div>
    </div>
  )
}

function CourseChoice({ course, selected, onSelect }: { course: TeacherClass; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(course.id)}
      aria-pressed={selected}
      className={`rounded-xl border p-4 text-left transition-colors ${selected ? 'border-accent bg-accent-soft/45' : 'border-border-subtle bg-surface hover:border-accent'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <InitialAvatar initials={course.section} className="size-10 rounded-lg" />
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-semibold">{course.name}</p>
            <p className="mt-1 text-sm text-ink-muted">Section {course.section} · {course.subject}</p>
          </div>
        </div>
        {selected && <span className="flex size-6 items-center justify-center rounded-full bg-accent text-white"><Check className="size-4" /></span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{course.studentCount} students</span>
        <span className="inline-flex items-center gap-1"><FileText className="size-3.5" />{course.assignmentCount} classwork</span>
      </div>
    </button>
  )
}

function ReviewStep({ courseId, onBack, onImport }: { courseId: string; onBack: () => void; onImport: (courseId: string) => void }) {
  const preview = useTeacherClassImportPreview(courseId)
  if (preview.isPending) return <LoadingState label="Preparing import preview..." />
  if (!preview.data) return <Empty title="Course preview unavailable" hint="Go back and select a course again." />

  return (
    <div className="mx-auto w-full max-w-4xl space-y-7">
      <PageHeading title={`Review ${preview.data.course.name}`} description={`Review the read-only resources that will be available for ${preview.data.course.name} · ${preview.data.course.section}.`} />
      <div className="grid gap-4 sm:grid-cols-2">
        {preview.data.resources.map((resource) => (
          <Card key={resource.key} className={resource.warning ? 'border-insufficient' : undefined}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                {resource.key === 'course' ? <BookOpen className="size-5" /> : resource.key === 'people' ? <Users className="size-5" /> : resource.key === 'drive' ? <HardDrive className="size-5" /> : <FileText className="size-5" />}
              </span>
              <StatusPill label={resource.warning ? 'Review' : 'Ready'} tone={resource.warning ? 'warning' : 'success'} />
            </div>
            <h2 className="mt-4 font-serif text-xl font-semibold">{resource.label}</h2>
            <p className="mt-1 text-sm text-ink-muted">{resource.detail}</p>
            <p className="mt-4 text-2xl font-semibold text-ink">{resource.count}</p>
          </Card>
        ))}
      </div>
      <Card className="flex gap-3 bg-canvas">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
        <p className="text-sm leading-6 text-ink-muted">Importing creates a local class view only. Google Classroom and Drive stay unchanged.</p>
      </Card>
      <div className="flex justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}><ChevronLeft className="size-4" />Back</Button>
        <Button type="button" onClick={() => onImport(courseId)}>Import class</Button>
      </div>
    </div>
  )
}
