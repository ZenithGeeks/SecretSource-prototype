import { BookOpen, ChevronRight, FileText, HardDrive, Search, ShieldCheck, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, Input } from '../../../components/ui'
import { useTeacherClassImportPreview, useTeacherImportableClasses } from '../../../lib/useTeacher'
import type { TeacherImportableClass } from '../../../lib/teacher'
import { Breadcrumbs, LoadingState, StatusPill } from '../components/TeacherUi'

export type AddClassStep = 'connect' | 'course' | 'review'

export function AddClass({ step, selectedCourseId, error, onBack, onClasses, onContinue, onSelectCourse, onImport }: {
  step: AddClassStep
  selectedCourseId?: string
  error?: string
  onBack: () => void
  onClasses?: () => void
  onContinue: () => void
  onSelectCourse: (courseId: string) => void
  onImport: (courseId: string) => void
}) {
  const crumb = step === 'connect' ? 'Connect Google' : step === 'course' ? 'Choose a course' : 'Review import'
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: 'Classes', onClick: onClasses ?? onBack }, { label: 'Add class' }, { label: crumb }]} />
      {step === 'connect'
        ? <ConnectStep error={error} onContinue={onContinue} />
        : step === 'course'
          ? <CourseStep selectedCourseId={selectedCourseId} onContinue={onContinue} onSelectCourse={onSelectCourse} />
          : <ReviewStep courseId={selectedCourseId ?? ''} onBack={onBack} onImport={onImport} />}
    </div>
  )
}

function StepBar({ active }: { active: 0 | 1 | 2 }) {
  const steps = ['Connect Google', 'Choose a class', 'Review import']
  return (
    <ol aria-label="Class import progress" className="flex min-h-[44px] items-center gap-3 rounded-[9px] border border-border-subtle bg-surface px-4 text-[11px]">
      {steps.map((step, index) => <li key={step} aria-current={active === index ? 'step' : undefined} className={`flex-1 ${index < active ? 'text-supports' : index === active ? 'font-semibold text-accent' : 'text-ink-muted'}`}>{index + 1} &nbsp;{step}</li>)}
    </ol>
  )
}

function AddClassHeading({ title, description }: { title: string; description: string }) {
  return <header><h1 className="font-serif text-[34px] font-semibold leading-[40px]">{title}</h1><p className="mt-1 text-[13px] leading-[18px] text-ink-muted">{description}</p></header>
}

function ConnectStep({ error, onContinue }: { error?: string; onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <AddClassHeading title="Connect Google Classroom" description="Choose the Google account that already has access to your class." />
      <StepBar active={0} />
      <Card className="mx-auto w-full max-w-[899px] space-y-3.5 rounded-[12px] p-6">
        <div className="flex items-center gap-3">
          <img src="/teacher/classroom-icon.png" alt="" width="40" height="40" className="shrink-0 object-contain" />
          <div><h2 className="text-[14px] font-semibold">Use your Google account</h2><p className="text-[10px] text-ink-muted">SecretSource will show courses available to this account.</p></div>
        </div>
        <p className="text-[11px] text-ink-muted">Connect once, then choose which existing course to import.</p>
        <AccessRow icon={ShieldCheck} title="Classroom course access" detail="Read course details, classwork, topics, announcements, roster, submissions and available grade status." />
        <AccessRow icon={FileText} title="Read linked essay files" detail="Google may ask for Drive permission to read files attached to Classroom work. Availability follows your account's file access." />
        <p className="rounded-md bg-supports-soft px-3 py-3 text-[10px] leading-[15px] text-supports">SecretSource mirrors Classroom data. It will not create courses, post work, edit rosters or change grades.</p>
        {error && <p role="alert" className="text-[11px] text-insufficient">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={onContinue}>Continue with Google</Button>
          <span className="text-[9px] text-ink-muted">Google handles sign-in and permission review.</span>
        </div>
      </Card>
    </div>
  )
}

function AccessRow({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return <div className="flex min-h-[61px] items-center gap-3 rounded-lg border border-border-subtle bg-canvas px-3 py-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="size-4" /></span><span><span className="block text-[10px] font-semibold">{title}</span><span className="mt-1 block text-[9px] leading-[13px] text-ink-muted">{detail}</span></span></div>
}

function CourseStep({ selectedCourseId, onContinue, onSelectCourse }: {
  selectedCourseId?: string
  onContinue: () => void
  onSelectCourse: (courseId: string) => void
}) {
  const courses = useTeacherImportableClasses()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (courses.data ?? []).filter((course) => !needle || [course.name, course.section, course.subject].some((value) => value.toLocaleLowerCase().includes(needle)))
  }, [courses.data, query])
  const selected = courses.data?.find((course) => course.id === selectedCourseId)

  return (
    <div className="space-y-4">
      <AddClassHeading title="Choose a class" description="Select one active course from Google Classroom to mirror." />
      <label className="relative block w-full sm:max-w-[587px]">
        <span className="sr-only">Search course name or section</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search course name or section" className="h-[42px] rounded-lg pl-9 text-[12px]" />
      </label>
      <p className="text-[10px] text-ink-muted">{filtered.length} courses available</p>
      {courses.isPending ? <LoadingState label="Loading available courses..." /> : courses.isError ? <Empty title="Courses could not load" hint="Return to Classes and try again." /> : filtered.length === 0 ? <Empty title="No matching courses" hint="Try searching by course name or section." /> : (
        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,675px)_minmax(240px,270px)]">
          <div className="space-y-3">{filtered.map((course) => <CourseChoice key={course.id} course={course} selected={course.id === selectedCourseId} onSelect={onSelectCourse} />)}</div>
          <Card className="min-h-[250px] p-3">
            {selected ? <>
              <h2 className="text-[11px] font-semibold">Selected course</h2>
              <h3 className="mt-2 font-serif text-[16px] font-semibold">{selected.name} · {selected.section}</h3>
              <p className="mt-1 text-[9px] text-ink-muted">{selected.teacherName} · Section {selected.section}</p>
              <div className="my-2 border-t border-border-subtle" />
              <p className="text-[9px]">1 teacher · {selected.studentCount} students</p>
              {selected.assignmentCount != null && <p className="mt-2 text-[9px]">{selected.assignmentCount} classwork items · {selected.topicCount} topics</p>}
              {selected.announcementCount != null && <p className="mt-2 text-[9px]">{selected.announcementCount} announcements · {selected.linkedFileCount} with linked files</p>}
              <StatusPill label="Read only" tone="accent" />
            </> : <p className="text-[10px] text-ink-muted">Select a course to review its details.</p>}
          </Card>
        </div>
      )}
      <div className="flex justify-end"><Button type="button" onClick={onContinue} disabled={!selectedCourseId}>Review import<ChevronRight className="size-4" /></Button></div>
    </div>
  )
}

function CourseChoice({ course, selected, onSelect }: { course: TeacherImportableClass; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(course.id)} aria-pressed={selected} className={`min-h-[130px] w-full rounded-[11px] border px-3 py-3 text-left transition-colors ${selected ? 'border-2 border-accent bg-accent-soft' : 'border-border-subtle bg-surface hover:border-accent'}`}>
      <div className="flex items-center gap-3">{selected && <span className="size-1.5 rounded-full bg-accent" />}<h2 className="truncate text-[14px] font-semibold">{course.name} · {course.section}</h2>{selected && <span className="ml-auto text-[9px] text-accent">SELECTED</span>}</div>
      <p className="mt-2 text-[9px] text-ink-muted">Section {course.section} · Taught by {course.teacherName}</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[9px] text-ink-muted"><span>{course.studentCount} people</span>{course.assignmentCount != null && <span>{course.assignmentCount} classwork items</span>}<span>Updated today</span></div>
      <p className="mt-2 text-[8px] text-ink-muted">Course details and work are retrieved from Classroom.</p>
    </button>
  )
}

function ReviewStep({ courseId, onBack, onImport }: { courseId: string; onBack: () => void; onImport: (courseId: string) => void }) {
  const preview = useTeacherClassImportPreview(courseId)
  if (preview.isPending) return <LoadingState label="Preparing import preview..." />
  if (preview.isError || !preview.data) return <Empty title="Course preview unavailable" hint="Go back and select a course again." />

  const course = preview.data.course
  const resourceIcon = { course: BookOpen, classwork: FileText, people: Users, drive: HardDrive }
  return (
    <div className="space-y-4">
      <AddClassHeading title="Review class import" description="Confirm what SecretSource can retrieve from this Classroom course." />
      <StepBar active={2} />
      <Card className="flex min-h-[66px] items-center gap-3 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><BookOpen className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate font-serif text-[16px] font-semibold">{course.name} · {course.section}</span><span className="block text-[9px] text-ink-muted">{course.subject} · {course.studentCount} students · {course.teacherName}</span><span className="block text-[9px] text-ink-muted">{course.assignmentCount} classwork items · {course.topicCount} topics · {course.announcementCount} announcements · {course.linkedFileCount} with linked files</span></span>
        <StatusPill label="Google Classroom" tone="accent" />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {preview.data.resources.map((resource) => {
          const Icon = resourceIcon[resource.key]
          return <Card key={resource.key} className="min-h-[86px] space-y-2 p-3">
            <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-[11px] font-semibold"><Icon className="size-3.5 text-ink-muted" />{resource.label}</h2><StatusPill label={resource.warning ? 'Needs access' : `${resource.count} ${resource.key === 'course' ? 'course' : 'items'}`} tone={resource.warning ? 'warning' : 'accent'} /></div>
            <p className="text-[9px] leading-[13px] text-ink-muted">{resource.detail}</p>
          </Card>
        })}
      </div>
      <Card className="flex min-h-[46px] items-center gap-3 rounded-lg bg-accent-soft px-4 py-3"><span className="text-[12px] text-accent">i</span><p className="text-[9px] leading-[13px]">Read-only mirror. Refresh to retrieve updates; course creation, posting, roster edits and grade changes stay in Google Classroom.</p></Card>
      <div className="flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onBack}>Back</Button><Button type="button" onClick={() => onImport(courseId)}>Import class</Button></div>
    </div>
  )
}
