import { CheckCircle2, ChevronRight, FileText, Play } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import type { TeacherAssignment, TeacherWorkspace } from '../../../lib/teacher'
import { assignmentCanBeChecked, workspaceStats } from '../../../lib/teacherSelectors'
import { StatusPill, MetricCard } from '../components/TeacherUi'

export function Classwork({ workspace, onOpenAssignment, onCheckEssays }: {
  workspace: TeacherWorkspace
  onOpenAssignment: (assignmentId: string) => void
  onCheckEssays: (assignmentId: string) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [queued, setQueued] = useState<string[]>([])
  const [skipped, setSkipped] = useState(0)
  const stats = workspaceStats(workspace)
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const analyze = () => {
    const eligible = selected.filter((id) => {
      const assignment = workspace.assignments.find((item) => item.id === id)
      return assignment ? assignment.submittedCount > 0 : false
    })
    setSkipped(selected.length - eligible.length)
    setQueued((current) => [...new Set([...current, ...eligible])])
    setSelected([])
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Classwork" value={stats.classworkCount} detail="assignments" />
        <MetricCard label="Submissions" value={stats.submissions} detail="across the class" tone="accent" />
        <MetricCard label="Returned" value={stats.returned} detail="with feedback" tone="success" />
      </section>

      <section className="space-y-3" aria-labelledby="classwork-list-heading">
        <div className="flex items-center justify-between gap-3"><div><h2 id="classwork-list-heading" className="font-serif text-2xl font-semibold">Classwork and grades</h2><p className="mt-1 text-sm text-ink-muted">Select assignments when you want to prepare them for Essay Check.</p></div><span className="text-xs text-ink-muted">{workspace.assignments.length} items</span></div>
        {workspace.assignments.length === 0 ? <Empty title="No classwork yet" hint="Assignments from the local class view will appear here." /> : workspace.assignments.map((assignment) => (
          <AssignmentRow key={assignment.id} assignment={assignment} selected={selected.includes(assignment.id)} queued={queued.includes(assignment.id)} onToggle={() => toggle(assignment.id)} onOpen={() => onOpenAssignment(assignment.id)} onCheck={() => onCheckEssays(assignment.id)} />
        ))}
      </section>

      <Card className="border-accent bg-accent-soft/30">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">Add to Essay Check</p>
            <h2 className="mt-1 font-serif text-xl font-semibold">Prepare selected classwork</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">This demo queues eligible local assignments only. It does not submit anything to Classroom.</p>
          </div>
          <Button type="button" onClick={analyze} disabled={selected.length === 0}><Play className="size-4" />Analyze selected ({selected.length})</Button>
        </div>
        {queued.length > 0 && <p className="mt-4 flex items-center gap-2 border-t border-accent/20 pt-3 text-sm text-supports"><CheckCircle2 className="size-4" />{queued.length} assignment{queued.length === 1 ? '' : 's'} queued locally.</p>}
        {skipped > 0 && <p className="mt-3 border-t border-insufficient/20 pt-3 text-sm text-insufficient">{skipped} selected assignment{skipped === 1 ? '' : 's'} skipped because it has no submitted attachment.</p>}
      </Card>
    </div>
  )
}

function AssignmentRow({ assignment, selected, queued, onToggle, onOpen, onCheck }: {
  assignment: TeacherAssignment
  selected: boolean
  queued: boolean
  onToggle: () => void
  onOpen: () => void
  onCheck: () => void
}) {
  const canCheck = assignmentCanBeChecked(assignment)
  const statusTone = assignment.status === 'returned' ? 'success' : assignment.status === 'pending' ? 'warning' : 'neutral'
  return (
    <Card className={selected ? 'border-accent bg-accent-soft/20' : undefined}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <label className="flex shrink-0 items-center gap-3">
          <input type="checkbox" checked={selected} onChange={onToggle} className="size-4 accent-accent" aria-label={`Select ${assignment.title}`} />
          <span className="flex size-10 items-center justify-center rounded-lg bg-canvas text-accent"><FileText className="size-5" /></span>
        </label>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left hover:text-accent">
          <span className="block truncate font-medium">{assignment.title}</span>
          <span className="mt-1 block text-xs text-ink-muted">Due {assignment.dueAt} · {assignment.materials.length} materials</span>
        </button>
        <div className="grid grid-cols-3 gap-3 text-xs text-ink-muted lg:w-64">
          <span><strong className="block text-sm text-ink">{assignment.enrolledCount}</strong>enrolled</span>
          <span><strong className="block text-sm text-supports">{assignment.submittedCount}</strong>submitted</span>
          <span><strong className="block text-sm text-refutes">{assignment.missingCount}</strong>missing</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill label={queued ? 'Queued' : assignment.status === 'not-started' ? 'Not started' : assignment.status} tone={queued ? 'accent' : statusTone} />
          {canCheck && <Button type="button" variant="ghost" onClick={onCheck}>Check essays</Button>}
          <button type="button" onClick={onOpen} aria-label={`Open ${assignment.title}`} className="rounded-lg p-2 text-ink-muted hover:bg-accent-soft hover:text-accent"><ChevronRight className="size-4" /></button>
        </div>
      </div>
    </Card>
  )
}
