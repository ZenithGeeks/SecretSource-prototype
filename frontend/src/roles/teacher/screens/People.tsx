import { Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card, Empty, Input } from '../../../components/ui'
import type { TeacherWorkspace } from '../../../lib/teacher'
import { InitialAvatar } from '../components/TeacherUi'

export function People({ workspace }: { workspace: TeacherWorkspace }) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const emailsByStudent = new Map(workspace.submissions.filter((submission) => submission.studentEmail).map((submission) => [submission.studentId, submission.studentEmail!]))
  const teachers = workspace.people.filter((person) => person.role === 'Teacher').map((person) => ({ ...person, email: undefined as string | undefined }))
  const students = workspace.people.filter((person) => person.role === 'Student').map((person) => ({ ...person, email: emailsByStudent.get(person.id) }))
  const normalized = query.trim().toLocaleLowerCase()
  const filteredTeachers = useMemo(() => teachers.filter((person) => matches(person, normalized)), [teachers, normalized])
  const filteredStudents = useMemo(() => students.filter((person) => matches(person, normalized)), [students, normalized])
  const shownStudents = showAll || normalized ? filteredStudents : filteredStudents.slice(0, 5)

  return (
    <div className="mx-auto w-full max-w-250 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-micro font-semibold uppercase tracking-widest text-accent">Class roster</p><h2 className="mt-1 font-serif text-[28px]/9 font-semibold">People</h2><p className="mt-1 text-[12px] text-ink-muted">{workspace.people.length} people in {workspace.course.name}.</p></div>
        <label className="relative block w-full sm:max-w-70"><span className="sr-only">Search people</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" className="h-10 rounded-lg pl-9 text-[12px]" /></label>
      </header>

      <Card className="overflow-hidden p-0">
        <RosterSection title="Teachers" count={filteredTeachers.length} people={filteredTeachers} empty="No teachers match this search." />
        <div className="border-t border-border-subtle" />
        <RosterSection title="Students" count={filteredStudents.length} people={shownStudents} empty="No students match this search." />
        {!normalized && filteredStudents.length > 5 && <button type="button" onClick={() => setShowAll((value) => !value)} className="w-full border-t border-border-subtle px-5 py-3 text-left text-caption font-medium text-accent hover:bg-canvas">{showAll ? 'Show fewer students' : `Show all ${filteredStudents.length} students`}</button>}
      </Card>

      <div className="flex items-center gap-2 rounded-lg bg-accent-soft/55 px-4 py-3 text-caption text-ink-muted"><Users className="size-4 shrink-0 text-accent" />Roster details are synced from Google Classroom and are read-only in SecretSource.</div>
    </div>
  )
}

type RosterPerson = { id: string; name: string; initials: string; role: string; email?: string }

function RosterSection({ title, count, people, empty }: { title: string; count: number; people: RosterPerson[]; empty: string }) {
  return <section aria-label={title}>
    <div className="flex items-center justify-between px-5 py-3"><h3 className="text-[12px] font-semibold">{title}</h3><span className="text-micro text-ink-muted">{count}</span></div>
    {people.length ? <div className="divide-y divide-border-subtle">{people.map((person) => <div key={person.id} className="flex min-h-16 items-center gap-3 px-5 py-2.5">
      <InitialAvatar initials={person.initials} className="size-9 text-caption" />
      <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{person.name}</p>{person.email && <p className="mt-0.5 truncate text-micro text-ink-muted">{person.email}</p>}</div>
      <span className="text-micro text-ink-muted">{person.role}</span>
    </div>)}</div> : <div className="px-5 pb-4"><Empty title={empty} hint="Try a different name or email." /></div>}
  </section>
}

function matches(person: RosterPerson, query: string) {
  return !query || `${person.name} ${person.email ?? ''} ${person.role}`.toLocaleLowerCase().includes(query)
}
