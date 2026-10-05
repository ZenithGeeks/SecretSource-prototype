import { CheckCircle2, FileText } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import type { TeacherAssignment, TeacherWorkspace } from '../../../lib/teacher'
import { workspaceStats } from '../../../lib/teacherSelectors'
import { usePrepareTeacherEssayChecks } from '../../../lib/useTeacher'
import { MetricCard, StatusPill } from '../components/TeacherUi'

export function Classwork({ workspace, onOpenAssignment }: {
  workspace: TeacherWorkspace
  onOpenAssignment: (assignmentId: string) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const preparation = usePrepareTeacherEssayChecks()
  const preparedAssignments = [...new Set(preparation.data?.prepared.map((item) => item.assignmentId) ?? [])]
  const stats = workspaceStats(workspace)
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const analyze = () => preparation.mutate({ courseId: workspace.course.id, assignmentIds: selected }, { onSuccess: () => setSelected([]) })

  return (
    <div className="space-y-3">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Classwork statistics">
        <MetricCard label="Classwork items" value={stats.classworkCount} />
        <MetricCard label="Submissions across course" value={stats.submissions} />
        <MetricCard label="Returned" value={stats.returned} detail="Grade status mirrored from Classroom" tone="success" />
      </section>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,704px)_minmax(250px,1fr)]">
        <Card className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-3"><h2 className="text-[13px] font-semibold">Assignments</h2><span className="text-[9px] text-ink-muted">Select assignments to analyze</span></div>
          {workspace.assignments.length === 0 ? <Empty title="No classwork yet" hint="Assignments from Classroom will appear here." /> : workspace.assignments.map((assignment) => (
            <AssignmentRow key={assignment.id} assignment={assignment} selected={selected.includes(assignment.id)} queued={preparedAssignments.includes(assignment.id)} onToggle={() => toggle(assignment.id)} onOpen={() => onOpenAssignment(assignment.id)} />
          ))}
        </Card>

        <Card className="min-h-[134px] space-y-2 rounded-[12px] bg-accent-soft p-3">
          <h2 className="text-[13px] font-semibold">Add to Essay Check</h2>
          <p className="text-[10px] leading-[14px]">Select one or more assignments, then select Analyze selected to send their submissions to Essay Check.</p>
          <Button type="button" onClick={analyze} disabled={selected.length === 0 || preparation.isPending}>{preparation.isPending ? 'Preparing...' : 'Analyze selected'}</Button>
          {preparation.isError && <p role="alert" className="border-t border-insufficient/20 pt-2 text-[10px] text-insufficient">{preparation.error instanceof Error ? preparation.error.message : 'Selected classwork could not be prepared.'}</p>}
          {preparation.data && <div className="space-y-1 border-t border-accent/20 pt-2 text-[10px]">
            {preparation.data.prepared.length > 0 && <p className="flex items-center gap-1.5 text-supports"><CheckCircle2 className="size-3.5" />{preparation.data.prepared.length} {preparation.data.prepared.length === 1 ? 'submission' : 'submissions'} sent to Essay Check.</p>}
            {preparation.data.skipped.map((item, index) => <p key={`skip-${item.assignmentId}-${item.submissionId ?? index}`} className="text-insufficient">{item.studentName ? `${item.studentName}: ` : ''}{item.reason}</p>)}
            {preparation.data.failed.map((item, index) => <p key={`failed-${item.assignmentId}-${item.submissionId ?? index}`} role="alert" className="text-refutes">{item.studentName ? `${item.studentName}: ` : ''}{item.reason}</p>)}
          </div>}
        </Card>
      </div>
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
  const tone = assignment.status === 'returned' ? 'success' : assignment.status === 'pending' ? 'warning' : 'neutral'
  return (
    <div className={`relative min-h-[98px] rounded-lg border p-3 ${selected ? 'border-accent bg-accent-soft/35' : 'border-border-subtle bg-canvas'}`}>
      <button type="button" onClick={onOpen} className="block w-full pr-8 text-left hover:text-accent">
        <span className="block truncate text-[10px] font-semibold">{assignment.title}</span>
        <span className="mt-2 block text-[9px] text-ink-muted">{assignment.submittedCount} / {assignment.enrolledCount} submitted · {assignment.missingCount} missing</span>
        <span className="mt-2 flex items-center gap-2"><StatusPill label={queued ? 'Queued' : assignment.status === 'not-started' ? 'Not started' : assignment.status} tone={queued ? 'accent' : tone} />{assignment.pendingReviewCount > 0 && <span className="text-[9px] text-insufficient">{assignment.pendingReviewCount} pending</span>}</span>
      </button>
      <span className="absolute right-3 top-3 text-[8px] text-ink-muted">Due {assignment.dueAt}</span>
      <label className="absolute right-3 top-9"><span className="sr-only">Select {assignment.title}</span><input type="checkbox" checked={selected} onChange={onToggle} className="size-3.5 accent-accent" /></label>
      <FileText className="absolute bottom-3 right-3 size-3.5 text-ink-muted" aria-hidden="true" />
    </div>
  )
}
