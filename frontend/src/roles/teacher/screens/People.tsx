import { Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card, Empty, Input } from '../../../components/ui'
import type { TeacherRosterMember, TeacherWorkspace } from '../../../lib/teacher'
import { filterTeacherPeople } from '../../../lib/teacherSelectors'
import { InitialAvatar } from '../components/TeacherUi'

export function People({ workspace }: { workspace: TeacherWorkspace }) {
  const [query, setQuery] = useState('')
  const people = useMemo(() => filterTeacherPeople(workspace.people, query), [workspace.people, query])
  const studentCount = workspace.people.filter((person) => person.role === 'Student').length
  const remaining = Math.max(0, workspace.course.studentCount - studentCount)

  return (
    <div className="space-y-3">
      <label className="relative block w-full sm:max-w-[586px]">
        <span className="sr-only">Search students by name</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students by name" className="h-[42px] rounded-lg pl-9 text-[12px]" />
      </label>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_248px]">
        <Card className="min-h-[439px] overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-3">
            <h2 className="text-[13px] font-semibold">Roster</h2><span className="text-[9px] text-ink-muted">Role · from Classroom</span>
          </div>
          {people.length === 0 ? <div className="p-4"><Empty title="No matching people" hint="Try another name." /></div> : <div className="divide-y divide-transparent">
            {people.map((person) => <PersonRow key={person.id} person={person} />)}
            {remaining > 0 && <div className="flex items-center gap-2.5 px-3 py-2.5"><span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[9px] text-accent">+</span><span><span className="block text-[10px] font-medium">View remaining {remaining} students</span><span className="block text-[9px] text-ink-muted">{workspace.course.studentCount} student records in Classroom</span></span><span className="ml-auto text-[9px] text-ink-muted">Student</span></div>}
          </div>}
        </Card>

        <div className="space-y-3">
          <Card className="space-y-2 p-3">
            <h2 className="text-[13px] font-semibold">People from Classroom</h2>
            <p className="text-[10px] font-medium">{workspace.people.filter((person) => person.role === 'Teacher').length} teacher · {workspace.course.studentCount} students</p>
            <p className="text-[9px] leading-[14px] text-ink-muted">Names and roles update when the class is refreshed.</p>
          </Card>
          <Card className="space-y-2 p-3">
            <div className="flex items-center gap-2"><ShieldCheck className="size-3.5 text-accent" /><h2 className="text-[13px] font-semibold">Account visibility</h2></div>
            <p className="text-[9px] leading-[14px] text-ink-muted">Only roster fields returned to this connected account are shown. Contact details appear only when Classroom provides them.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}

function PersonRow({ person }: { person: TeacherRosterMember }) {
  return (
    <div className="flex min-h-[38px] items-center gap-2.5 px-3 py-1.5">
      <InitialAvatar initials={person.initials} className="size-[22px] text-[8px]" />
      <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{person.name}</p><p className="text-[8px] text-ink-muted">{person.isCourseOwner ? 'Course owner' : person.role}</p></div>
      <span className="w-16 text-[9px] text-ink-muted">{person.role}</span>
    </div>
  )
}
