import { CheckCircle2, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import type { TeacherAssignment, TeacherWorkspace } from '../../../lib/teacher'
import { usePrepareTeacherEssayChecks } from '../../../lib/useTeacher'
import { StatusPill } from '../components/TeacherUi'

export function Classwork({ workspace, onOpenAssignment }: {
  workspace: TeacherWorkspace
  onOpenAssignment: (assignmentId: string) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const preparation = usePrepareTeacherEssayChecks()
  const preparedAssignments = [...new Set(preparation.data?.prepared.map((item) => item.assignmentId) ?? [])]
  const assignments = workspace.assignments
  const selectedEssayCount = useMemo(() => assignments
    .filter((assignment) => selected.includes(assignment.id))
    .reduce((sum, assignment) => sum + assignment.submittedCount, 0), [assignments, selected])
  const allSelected = assignments.length > 0 && selected.length === assignments.length
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const toggleAll = () => setSelected((current) => current.length === assignments.length ? [] : assignments.map((assignment) => assignment.id))
  const checkEssays = () => preparation.mutate({ courseId: workspace.course.id, assignmentIds: selected }, { onSuccess: () => setSelected([]) })

  if (assignments.length === 0) return <Empty title="No classwork yet" hint="Assignments from Google Classroom will appear here." />

  return (
    <div className="space-y-4">
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="bg-surface text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            <tr className="h-[42px] border-b border-border-subtle">
              <th className="w-12 px-4"><input aria-label="Select all assignments" type="checkbox" checked={allSelected} onChange={toggleAll} className="size-4 accent-accent" /></th>
              <th className="px-2">Assignment</th><th className="w-32 px-3">Due</th><th className="w-36 px-3">Submitted</th><th className="w-24 px-3">Missing</th><th className="w-24 px-3">Returned</th><th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle text-[11px]">
            {assignments.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} selected={selected.includes(assignment.id)} queued={preparedAssignments.includes(assignment.id)} onToggle={() => toggle(assignment.id)} onOpen={() => onOpenAssignment(assignment.id)} />)}
          </tbody>
        </table>
      </Card>

      {selected.length > 0 && <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-surface shadow-[0_8px_32px_rgba(30,26,34,0.22)]">
        <p className="text-[11px]">{selected.length} {selected.length === 1 ? 'assignment' : 'assignments'} selected · {selectedEssayCount} essays</p>
        <div className="flex items-center gap-3"><button type="button" onClick={() => setSelected([])} className="text-[11px] text-surface/80 hover:text-white">Clear</button><Button type="button" onClick={checkEssays} disabled={preparation.isPending}>{preparation.isPending ? 'Checking…' : `Check ${selectedEssayCount} essays`}</Button></div>
      </div>}

      <p className="text-[10px] text-ink-muted">Submission and grade status come from Classroom, read-only.</p>
      {preparation.isError && <p role="alert" className="text-[11px] text-refutes">{preparation.error instanceof Error ? preparation.error.message : 'Selected classwork could not be prepared.'}</p>}
      {preparation.data && <Card className="space-y-2 p-3">
        {preparation.data.prepared.length > 0 && <p className="flex items-center gap-2 text-[11px] text-supports"><CheckCircle2 className="size-4" />{preparation.data.prepared.length} {preparation.data.prepared.length === 1 ? 'essay' : 'essays'} added to review.</p>}
        {preparation.data.skipped.map((item, index) => <p key={`skip-${item.assignmentId}-${item.submissionId ?? index}`} className="text-[10px] text-insufficient">{item.studentName ? `${item.studentName}: ` : ''}{item.reason}</p>)}
        {preparation.data.failed.map((item, index) => <p key={`failed-${item.assignmentId}-${item.submissionId ?? index}`} role="alert" className="text-[10px] text-refutes">{item.studentName ? `${item.studentName}: ` : ''}{item.reason}</p>)}
      </Card>}
    </div>
  )
}

function AssignmentRow({ assignment, selected, queued, onToggle, onOpen }: {
  assignment: TeacherAssignment
  selected: boolean
  queued: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return <tr className={`h-[61px] transition-colors ${selected ? 'bg-accent-soft/60' : 'hover:bg-canvas'}`}>
    <td className="px-4"><input aria-label={`Select ${assignment.title}`} type="checkbox" checked={selected} onChange={onToggle} className="size-4 accent-accent" /></td>
    <td className="px-2"><button type="button" onClick={onOpen} className="text-left"><span className="block font-medium text-ink hover:text-accent">{assignment.title}</span><span className="mt-1 block text-[10px] text-ink-muted">Google Classroom assignment{queued ? ' · added to review' : ''}</span></button></td>
    <td className="px-3">{assignment.dueAt}</td><td className="px-3">{assignment.submittedCount} of {assignment.enrolledCount}</td><td className={`px-3 ${assignment.missingCount ? 'text-refutes' : ''}`}>{assignment.missingCount}</td><td className="px-3">{assignment.returnedCount}</td>
    <td className="px-2">{queued ? <StatusPill label="Queued" tone="accent" /> : <ChevronRight className="size-3.5 text-ink-muted" />}</td>
  </tr>
}
