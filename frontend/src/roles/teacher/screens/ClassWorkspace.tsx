import { AlertCircle, Bell, BookOpen, ChevronRight, FileText, GraduationCap, Link2, Users } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherWorkspace } from '../../../lib/useTeacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import type { TeacherWorkspace } from '../../../lib/teacher'
import { workspaceStats, type WorkspaceTab } from '../../../lib/teacherSelectors'
import { ClassWorkspaceHeader } from '../components/ClassWorkspaceHeader'
import { InitialAvatar, LoadingState, MetricCard, StatusPill } from '../components/TeacherUi'
import { Classwork } from './Classwork'
import { People } from './People'

export function ClassWorkspace({
  courseId,
  tab,
  onNavigate,
  onRefresh,
}: {
  courseId: string
  tab: WorkspaceTab
  onNavigate: (route: TeacherRoute) => void
  onRefresh: () => void
}) {
  const workspace = useTeacherWorkspace(courseId)
  if (workspace.isPending) return <LoadingState label="Loading class workspace..." />
  if (workspace.isError || !workspace.data) {
    return (
      <Empty
        title="Class workspace unavailable"
        hint="This class is not available in the local teacher session."
      />
    )
  }

  const data = workspace.data
  const setTab = (next: WorkspaceTab) => onNavigate({
    screen: next === 'overview' ? 'class-overview' : next,
    courseId,
  })

  return (
    <div className="space-y-7">
      <ClassWorkspaceHeader
        workspace={data}
        activeTab={tab}
        onTabChange={setTab}
        onRefresh={onRefresh}
        refreshing={workspace.isFetching}
      />
      {tab === 'overview' ? (
        <OverviewTab
          workspace={data}
          onOpenAssignment={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })}
          onOpenClasswork={() => setTab('classwork')}
        />
      ) : tab === 'classwork' ? (
        <Classwork
          workspace={data}
          onOpenAssignment={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })}
          onCheckEssays={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })}
        />
      ) : (
        <People workspace={data} />
      )}
    </div>
  )
}

function OverviewTab({ workspace, onOpenAssignment, onOpenClasswork }: {
  workspace: TeacherWorkspace
  onOpenAssignment: (assignmentId: string) => void
  onOpenClasswork: () => void
}) {
  const stats = workspaceStats(workspace)
  const students = workspace.people.filter((person) => person.role === 'Student').slice(0, 4)

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-serif text-2xl font-semibold">Course overview</h2>
          <StatusPill label="Synced today" tone="success" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Classwork" value={stats.classworkCount} detail="active assignments" />
          <MetricCard label="Submissions" value={stats.submissions} detail={`of ${workspace.course.studentCount * stats.classworkCount} expected`} tone="accent" />
          <MetricCard label="Returned" value={stats.returned} detail="submissions with feedback" tone="success" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-semibold">Recent classwork</h2>
              <p className="mt-1 text-sm text-ink-muted">The latest work from your class.</p>
            </div>
            <Button type="button" variant="ghost" onClick={onOpenClasswork}>View all <ChevronRight className="size-4" /></Button>
          </div>
          <div className="mt-5 divide-y divide-border-subtle">
            {workspace.assignments.slice(0, 3).map((assignment) => (
              <button key={assignment.id} type="button" onClick={() => onOpenAssignment(assignment.id)} className="flex w-full items-center justify-between gap-4 py-4 text-left first:pt-0 last:pb-0 hover:text-accent">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{assignment.title}</span>
                  <span className="mt-1 block text-xs text-ink-muted">Due {assignment.dueAt} · {assignment.submittedCount} submitted</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {assignment.pendingReviewCount > 0 && <StatusPill label={`${assignment.pendingReviewCount} to check`} tone="warning" />}
                  <ChevronRight className="size-4 text-ink-muted" />
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Bell className="size-5" /></span>
            <div>
              <h2 className="font-serif text-xl font-semibold">Announcement</h2>
              {workspace.latestAnnouncement ? (
                <>
                  <p className="mt-3 text-sm font-medium">{workspace.latestAnnouncement.title}</p>
                  <p className="mt-1 text-xs text-ink-muted">{workspace.latestAnnouncement.postedBy} · {workspace.latestAnnouncement.postedAt}</p>
                  <p className="mt-3 text-sm leading-6 text-ink-muted">{workspace.latestAnnouncement.body}</p>
                </>
              ) : <p className="mt-3 text-sm text-ink-muted">No announcements yet.</p>}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-xl font-semibold">People</h2><Users className="size-5 text-accent" /></div>
          <div className="mt-4 space-y-3">
            {students.map((person) => <div key={person.id} className="flex items-center gap-2.5"><InitialAvatar initials={person.initials} className="size-8" /><span className="text-sm">{person.name}</span></div>)}
          </div>
          <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-ink-muted">{workspace.course.studentCount} students in this class</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-xl font-semibold">Materials</h2><FileText className="size-5 text-accent" /></div>
          <div className="mt-4 space-y-3">
            {workspace.materials.map((material) => <div key={material.id} className="flex items-center gap-2.5 text-sm"><span className="flex size-7 items-center justify-center rounded-md bg-canvas text-accent">{material.kind === 'link' ? <Link2 className="size-3.5" /> : <FileText className="size-3.5" />}</span><span className="min-w-0 flex-1 truncate">{material.title}</span>{!material.accessible && <AlertCircle className="size-4 shrink-0 text-insufficient" />}</div>)}
          </div>
          <p className="mt-4 text-xs text-ink-muted">{workspace.course.linkedFileCount} linked files from Classroom</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-xl font-semibold">Topics</h2><BookOpen className="size-5 text-accent" /></div>
          <div className="mt-4 space-y-3">
            {workspace.topics.map((topic) => <div key={topic.id} className="flex items-center justify-between gap-3 text-sm"><span>{topic.name}</span><span className="text-xs text-ink-muted">{topic.assignmentCount} items</span></div>)}
          </div>
          <p className="mt-4 text-xs text-ink-muted">Organized from your local class view</p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><GraduationCap className="size-5" /></span><div><h2 className="font-serif text-xl font-semibold">Grades & submissions</h2><p className="mt-1 text-sm text-ink-muted">Open Classwork and grades to review the submission queue.</p></div></div>
        <Button type="button" variant="ghost" onClick={onOpenClasswork}>Open classwork <ChevronRight className="size-4" /></Button>
      </Card>
    </div>
  )
}
