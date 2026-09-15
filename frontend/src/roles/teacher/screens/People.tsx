import { Search, ShieldCheck, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card, Empty, Input } from '../../../components/ui'
import type { TeacherRosterMember, TeacherWorkspace } from '../../../lib/teacher'
import { filterTeacherPeople } from '../../../lib/teacherSelectors'
import { InitialAvatar, PageHeading, StatusPill } from '../components/TeacherUi'

export function People({ workspace }: { workspace: TeacherWorkspace }) {
  const [query, setQuery] = useState('')
  const people = useMemo(() => filterTeacherPeople(workspace.people, query), [workspace.people, query])
  const studentCount = workspace.people.filter((person) => person.role === 'Student').length
  const remaining = Math.max(0, workspace.course.studentCount - studentCount)

  return (
    <div className="space-y-6">
      <PageHeading title="People" description="The roster is shown as read-only data from this local class view." />
      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-border-subtle p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-serif text-xl font-semibold">Class roster</h2><p className="mt-1 text-sm text-ink-muted">{workspace.course.studentCount} people in {workspace.course.name} · {workspace.course.section}</p></div>
          <label className="relative block w-full sm:max-w-xs"><span className="sr-only">Search people</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" className="pl-9" /></label>
        </div>
        {people.length === 0 ? <div className="p-5"><Empty title="No matching people" hint="Try another name or role." /></div> : <div className="divide-y divide-border-subtle">
          {people.map((person) => <PersonRow key={person.id} person={person} />)}
          {remaining > 0 && <div className="flex items-center gap-3 px-5 py-4 text-sm text-ink-muted"><span className="flex size-9 items-center justify-center rounded-full bg-canvas text-xs font-semibold">+{remaining}</span><span>{remaining} more students from Classroom</span></div>}
        </div>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex gap-3 bg-accent-soft/35"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" /><div><h2 className="font-serif text-lg font-semibold">People from Classroom</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Roster names and course ownership are read-only in this frontend prototype.</p></div></Card>
        <Card className="flex gap-3"><UserRound className="mt-0.5 size-5 shrink-0 text-ink-muted" /><div><h2 className="font-serif text-lg font-semibold">Account visibility</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Student visibility preferences can be changed in Settings. No roster updates are sent externally.</p></div></Card>
      </div>
    </div>
  )
}

function PersonRow({ person }: { person: TeacherRosterMember }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <InitialAvatar initials={person.initials} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{person.name}</p><p className="mt-0.5 text-xs text-ink-muted">{person.role}{person.isCourseOwner ? ' · Course owner' : ''}</p></div>
      <StatusPill label={person.role === 'Teacher' ? 'Teacher' : 'Student'} tone={person.role === 'Teacher' ? 'accent' : 'neutral'} />
    </div>
  )
}
