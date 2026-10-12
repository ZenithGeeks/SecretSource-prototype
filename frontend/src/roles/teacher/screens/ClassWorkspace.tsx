import { AlertCircle, ArrowUpRight, FileText } from 'lucide-react'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherGoogleConnection, useTeacherWorkspace } from '../../../lib/useTeacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import type { TeacherWorkspace } from '../../../lib/teacher'
import { workspaceStats, type WorkspaceTab } from '../../../lib/teacherSelectors'
import { ClassWorkspaceHeader } from '../components/ClassWorkspaceHeader'
import { InitialAvatar, LoadingState, StatusPill } from '../components/TeacherUi'
import { Classwork } from './Classwork'
import { People } from './People'

export function ClassWorkspace({ courseId, tab, onNavigate, onRefresh }: {
  courseId: string
  tab: WorkspaceTab
  onNavigate: (route: TeacherRoute) => void
  onRefresh: () => void
  refreshing?: boolean
}) {
  const workspace = useTeacherWorkspace(courseId)
  const googleConnection = useTeacherGoogleConnection()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!googleConnection.data?.connected) return
    const syncKey = ['teacher', 'class-auto-sync', courseId]
    const lastSyncedAt = queryClient.getQueryData<number>(syncKey)
    if (lastSyncedAt && Date.now() - lastSyncedAt < 5 * 60_000) return
    queryClient.setQueryData(syncKey, Date.now())
    onRefresh()
  }, [courseId, googleConnection.data?.connected, onRefresh, queryClient])

  if (workspace.isPending) return <LoadingState label="Loading class workspace..." />
  if (workspace.isError || !workspace.data) return <Empty title="Class workspace unavailable" hint="This class is not available in the local teacher session." />

  const data = workspace.data
  const setTab = (next: WorkspaceTab) => onNavigate({ screen: next === 'overview' ? 'class-overview' : next, courseId })

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-5">
      <ClassWorkspaceHeader workspace={data} activeTab={tab} onTabChange={setTab} />
      {tab === 'overview' ? (
        <OverviewTab
          workspace={data}
          onOpenAssignment={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })}
          onCheckEssays={(assignmentId, studentId) => onNavigate({ screen: 'essay-check', courseId, assignmentId, studentId })}
          onOpenClasswork={() => setTab('classwork')}
          onOpenPeople={() => setTab('people')}
        />
      ) : tab === 'classwork' ? (
        <Classwork workspace={data} onOpenAssignment={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })} />
      ) : <People workspace={data} />}
    </div>
  )
}

function OverviewTab({ workspace, onOpenAssignment, onCheckEssays, onOpenClasswork, onOpenPeople }: {
  workspace: TeacherWorkspace
  onOpenAssignment: (assignmentId: string) => void
  onCheckEssays: (assignmentId: string, studentId: string) => void
  onOpenClasswork: () => void
  onOpenPeople: () => void
}) {
  const stats = workspaceStats(workspace)
  const people = workspace.people.filter((person) => person.role === 'Student').slice(0, 5)
  const nextToReview = workspace.assignments.find((assignment) => assignment.pendingReviewCount > 0) ?? workspace.assignments[0]
  const firstSubmission = nextToReview
    ? workspace.submissions.find((submission) => submission.assignmentId === nextToReview.id && submission.state !== 'missing' && submission.attachments.length > 0)
    : undefined
  const recent = workspace.assignments.slice(0, 3)

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,640px)_minmax(250px,1fr)]">
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Needs you</p>
            {nextToReview ? <><h2 className="mt-2 font-serif text-[21px] font-semibold">{nextToReview.title}</h2><p className="mt-1 text-[11px] text-ink-muted">Due {nextToReview.dueAt} · {nextToReview.submittedCount} of {nextToReview.enrolledCount} submitted · {nextToReview.pendingReviewCount} not reviewed</p></> : <><h2 className="mt-2 font-serif text-[21px] font-semibold">You’re all caught up</h2><p className="mt-1 text-[11px] text-ink-muted">New work that needs review will show up here.</p></>}
          </div>
          {nextToReview && <Button type="button" onClick={() => firstSubmission && onCheckEssays(nextToReview.id, firstSubmission.studentId)} disabled={!firstSubmission}>Check {nextToReview.pendingReviewCount || nextToReview.submittedCount} essays</Button>}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3"><h2 className="text-[13px] font-semibold">Recent classwork</h2><button type="button" onClick={onOpenClasswork} className="text-[11px] font-medium text-accent hover:underline">See all</button></div>
          {recent.length ? <div className="divide-y divide-border-subtle">{recent.map((assignment) => <button key={assignment.id} type="button" onClick={() => onOpenAssignment(assignment.id)} className="flex min-h-[61px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-canvas">
            <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{assignment.title}</span><span className="mt-1 block text-[10px] text-ink-muted">Due {assignment.dueAt}</span></span>
            <span className="text-right text-[10px] text-ink-muted">{assignment.submittedCount} of {assignment.enrolledCount} submitted</span><ArrowUpRight className="size-3.5 shrink-0 text-ink-muted" />
          </button>)}</div> : <div className="p-4"><Empty title="No classwork yet" hint="Assignments from Classroom will appear here." /></div>}
        </Card>

        <Card className="space-y-2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Latest announcement</p>
          {workspace.latestAnnouncement ? <><h2 className="text-[13px] font-semibold">{workspace.latestAnnouncement.title}</h2><p className="text-[10px] text-ink-muted">{workspace.latestAnnouncement.body}</p><p className="text-[9px] text-ink-muted">{workspace.latestAnnouncement.postedBy} · {workspace.latestAnnouncement.postedAt}</p></> : <p className="text-[11px] text-ink-muted">No announcements yet.</p>}
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="space-y-2.5 p-4">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">People</h2><span className="text-[10px] text-ink-muted">{workspace.course.studentCount} students</span></div>
          <div className="flex items-center gap-1">{people.map((person) => <InitialAvatar key={person.id} initials={person.initials} className="size-7 text-[9px]" />)}{workspace.course.studentCount > people.length && <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[9px] text-accent">+{workspace.course.studentCount - people.length}</span>}</div>
          <button type="button" onClick={onOpenPeople} className="text-[10px] font-medium text-accent hover:underline">Full roster in People →</button>
        </Card>

        <Card className="space-y-2.5 p-4">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Materials</h2><span className="text-[10px] text-ink-muted">{workspace.course.linkedFileCount} linked</span></div>
          {workspace.materials.slice(0, 3).map((material) => <p key={material.id} className="flex items-center gap-2 text-[10px]"><FileText className="size-3.5 shrink-0 text-ink-muted" /><span className="truncate">{material.title}</span>{!material.accessible && <AlertCircle className="size-3 shrink-0 text-insufficient" />}</p>)}
          {workspace.materials.some((material) => !material.accessible) && <StatusPill label="1 file needs Drive access" tone="warning" />}
        </Card>

        <Card className="space-y-2 p-4"><h2 className="text-[13px] font-semibold">Grades &amp; submissions</h2><p className="text-[11px]">{stats.returned} returned · {Math.max(0, stats.submissions - stats.returned)} pending</p><p className="text-[10px] text-ink-muted">Read-only, from Classroom</p></Card>
      </div>
    </div>
  )
}
