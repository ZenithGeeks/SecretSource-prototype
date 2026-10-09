import { Check, ChevronLeft, ChevronRight, FileText, GraduationCap, HardDrive, Loader2, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, Input } from '../../../components/ui'
import { useTeacherClassImportPreview, useTeacherClasses, useTeacherImportableClasses } from '../../../lib/useTeacher'
import type { TeacherClass } from '../../../lib/teacher'
import { LoadingState, StatusPill } from '../components/TeacherUi'

export type AddClassStep = 'connect' | 'course' | 'review'

export function AddClass({ step, selectedCourseId, error, onBack, onContinue, onSelectCourse, onImport, onReconnectGoogle, importing = false, importError }: {
  step: AddClassStep
  selectedCourseId?: string
  error?: string
  onBack: () => void
  onClasses?: () => void
  onContinue: () => void
  onSelectCourse: (courseId: string) => void
  onImport: (courseId: string) => void
  onReconnectGoogle?: () => void
  importing?: boolean
  importError?: string
}) {
  const active = step === 'connect' ? 0 : step === 'course' ? 1 : 2
  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-7">
      <StepBar active={active} />
      {step === 'connect'
        ? <ConnectStep error={error} onContinue={onContinue} />
        : step === 'course'
          ? <CourseStep selectedCourseId={selectedCourseId} onBack={onBack} onContinue={onContinue} onSelectCourse={onSelectCourse} onReconnectGoogle={onReconnectGoogle} />
          : <ReviewStep courseId={selectedCourseId ?? ''} onBack={onBack} onImport={onImport} importing={importing} importError={importError} />}
    </div>
  )
}

function StepBar({ active }: { active: number }) {
  const steps = ['Connect Google', 'Choose a class', 'Review import']
  return (
    <ol aria-label="Class import progress" className="mx-auto flex w-fit max-w-full items-center gap-2 overflow-x-auto py-1 text-[11px]">
      {steps.map((step, index) => {
        const complete = index < active
        const current = index === active
        return <li key={step} className="flex shrink-0 items-center gap-2">
          <span className={`flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${complete ? 'bg-supports-soft text-supports' : current ? 'bg-accent text-white' : 'bg-[#ece9e3] text-ink-muted'}`} aria-current={current ? 'step' : undefined}>{complete ? <Check className="size-3.5" /> : index + 1}</span>
          <span className={current ? 'font-medium text-ink' : 'text-ink-muted'}>{step}</span>
          {index < steps.length - 1 && <span className="mx-2 h-px w-8 bg-border-subtle sm:w-12" />}
        </li>
      })}
    </ol>
  )
}

function ConnectStep({ error, onContinue }: { error?: string; onContinue: () => void }) {
  return (
    <Card className="mx-auto w-full max-w-[600px] space-y-5 rounded-[14px] p-7 sm:p-8">
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><GraduationCap className="size-5" /></div>
      <header className="space-y-2">
        <h1 className="font-serif text-[28px] font-semibold leading-9">Connect Google Classroom</h1>
        <p className="text-[13px] leading-5 text-ink-muted">We bring in your classes, students and classwork so you can check submitted essays.</p>
      </header>
      <section className="space-y-3" aria-labelledby="classroom-access-heading">
        <h2 id="classroom-access-heading" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">What we read</h2>
        <AccessRow icon={GraduationCap} title="Classroom course access" detail="Courses, classwork, topics, rosters and submissions." />
        <AccessRow icon={FileText} title="Classwork" detail="Assignments, due dates and student work." />
        <AccessRow icon={HardDrive} title="Drive files attached to classwork" detail="Drive access only for linked assignment files." />
      </section>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2.5 text-[11px]">
        <StatusPill label="Read-only" tone="accent" />
        <span className="text-ink-muted">Read-only mirror. Courses, posts, rosters and grades stay in Classroom.</span>
      </div>
      {error && <p role="alert" className="text-[12px] text-refutes">{error}</p>}
      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11px] text-ink-muted">Google handles sign-in and permission review.</span>
        <Button type="button" onClick={onContinue}>Continue with Google</Button>
      </div>
    </Card>
  )
}

function AccessRow({ icon: Icon, title, detail }: { icon: typeof GraduationCap; title: string; detail: string }) {
  return <div className="flex items-center gap-3 rounded-lg px-1 py-1.5">
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-supports"><Check className="size-4" /></span>
    <span><span className="block text-[12px] font-medium">{title}</span><span className="mt-0.5 block text-[11px] text-ink-muted">{detail}</span></span>
    <Icon className="sr-only" aria-hidden="true" />
  </div>
}

function CourseStep({ selectedCourseId, onBack, onContinue, onSelectCourse, onReconnectGoogle }: {
  selectedCourseId?: string
  onBack: () => void
  onContinue: () => void
  onSelectCourse: (courseId: string) => void
  onReconnectGoogle?: () => void
}) {
  const courses = useTeacherImportableClasses()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (courses.data ?? []).filter((course) => !needle || [course.name, course.section, course.subject].some((value) => value.toLocaleLowerCase().includes(needle)))
  }, [courses.data, query])
  const selected = courses.data?.find((course) => course.id === selectedCourseId)

  return (
    <div className="space-y-5">
      <header><h1 className="font-serif text-[28px] font-semibold">Choose a class</h1><p className="mt-1 text-[13px] text-ink-muted">{courses.data?.length ?? 0} courses available in Google Classroom.</p></header>
      {courses.isPending ? <LoadingState label="Loading available classes..." /> : courses.isError ? <div className="space-y-3"><Empty title="Classes could not load" hint="Reconnect Google Classroom and try again." />{onReconnectGoogle && <div className="flex justify-center"><Button type="button" variant="ghost" onClick={onReconnectGoogle}>Reconnect Google Classroom</Button></div>}</div> : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <label className="relative block">
              <span className="sr-only">Search course name or section</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search course name or section" className="h-[38px] rounded-lg pl-9 text-[11px]" />
            </label>
            {filtered.length === 0 ? <Empty title="No matching classes" hint="Try another search term." /> : filtered.map((course) => <CourseChoice key={course.id} course={course} selected={course.id === selectedCourseId} onSelect={onSelectCourse} />)}
          </div>
          <Card className="space-y-3 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">You’ll import</p>
            {selected ? <>
              <h2 className="font-serif text-[20px] font-semibold leading-6">{selected.name} · {selected.section}</h2>
              <p className="text-[11px] text-ink-muted">{selected.teacherName} · Section {selected.section}</p>
              <div className="space-y-2 text-[11px]"><p>{plural(selected.teacherCount ?? (selected.teacherName ? 1 : 0), 'teacher')} · {plural(selected.studentCount, 'student')}</p><p>{plural(selected.assignmentCount, 'assignment')} · {plural(selected.topicCount, 'topic')}</p><p>{plural(selected.linkedFileCount, 'material')}</p></div>
            </> : <p className="text-[11px] text-ink-muted">Choose a class to see its import details.</p>}
          </Card>
        </div>
      )}
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={onBack}><ChevronLeft className="size-4" />Back</Button><Button type="button" onClick={onContinue} disabled={!selectedCourseId}>Review import<ChevronRight className="size-4" /></Button></div>
    </div>
  )
}

function CourseChoice({ course, selected, onSelect }: { course: TeacherClass; selected: boolean; onSelect: (id: string) => void }) {
  return <button type="button" onClick={() => onSelect(course.id)} aria-pressed={selected} className={`flex min-h-[66px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${selected ? 'border-2 border-accent bg-accent-soft' : 'border-border-subtle bg-surface hover:border-accent'}`}>
    <span className={`size-4 shrink-0 rounded-full border ${selected ? 'border-accent bg-accent ring-4 ring-accent/10' : 'border-border-subtle'}`} />
    <span className="min-w-0"><span className="block truncate text-[12px] font-semibold">{course.name} · {course.section}</span><span className="mt-1 block truncate text-[10px] text-ink-muted">Section {course.section} · {course.teacherName || 'Teacher'} · {course.studentCount} students · {course.assignmentCount} assignments</span></span>
  </button>
}

function ReviewStep({ courseId, onBack, onImport, importing, importError }: { courseId: string; onBack: () => void; onImport: (courseId: string) => void; importing: boolean; importError?: string }) {
  const preview = useTeacherClassImportPreview(courseId)
  const classes = useTeacherClasses()
  if (preview.isPending) return <LoadingState label="Preparing import preview..." />
  if (preview.isError || !preview.data) return <Empty title="Course preview unavailable" hint="Go back and select a class again." />

  const alreadyImported = classes.data?.some((course) => course.id === courseId) ?? false
  const checkingImportStatus = classes.isPending
  const icons = { course: GraduationCap, people: Users, classwork: FileText, drive: HardDrive }
  return (
    <div className="space-y-5">
      <header><h1 className="font-serif text-[28px] font-semibold">Review class import</h1><p className="mt-1 text-[13px] text-ink-muted">Confirm what SecretSource can retrieve from this Classroom course.</p></header>
      <Card className="overflow-hidden p-0">
        {preview.data.resources.map((resource) => {
          const Icon = icons[resource.key]
          const count = resource.key === 'course' ? '1 course' : resource.key === 'people' ? `${resource.count} people` : resource.key === 'classwork' ? `${resource.count} assignments` : `${resource.count} materials`
          return <div key={resource.key} className="flex min-h-[70px] items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink"><Icon className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium">{resource.label}</span><span className="mt-1 block truncate text-[10px] text-ink-muted">{resource.detail}</span></span>
            <StatusPill label={resource.warning ? `${resource.count} need access` : count} tone={resource.warning ? 'warning' : 'neutral'} />
          </div>
        })}
      </Card>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2.5 text-[11px]"><StatusPill label="Read-only" tone="accent" /><span className="text-ink-muted">Refresh for updates; course creation, posts, roster edits and grade changes stay in Classroom.</span></div>
      {importError && <p role="alert" className="text-sm text-refutes">{importError}</p>}
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={onBack}><ChevronLeft className="size-4" />Back</Button><Button type="button" onClick={() => onImport(courseId)} disabled={alreadyImported || importing || checkingImportStatus} aria-busy={importing || checkingImportStatus} className="transition-transform duration-150 active:scale-[0.98]">
        {importing ? <><Loader2 className="size-4 animate-spin" />Importing class…</> : alreadyImported ? <><Check className="size-4" />Already imported</> : checkingImportStatus ? <><Loader2 className="size-4 animate-spin" />Checking class…</> : 'Import class'}
      </Button></div>
    </div>
  )
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
