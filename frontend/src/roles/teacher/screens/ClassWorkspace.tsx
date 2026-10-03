import { AlertCircle, FileText } from 'lucide-react'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button, Card, Empty } from '../../../components/ui'
import { useTeacherGoogleConnection, useTeacherWorkspace } from '../../../lib/useTeacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import type { TeacherWorkspace } from '../../../lib/teacher'
import { workspaceStats, type WorkspaceTab } from '../../../lib/teacherSelectors'
import { ClassWorkspaceHeader } from '../components/ClassWorkspaceHeader'
import { InitialAvatar, LoadingState } from '../components/TeacherUi'
import { Classwork } from './Classwork'
import { People } from './People'

export function ClassWorkspace({ courseId, tab, onNavigate, onRefresh, refreshing = false }: {
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
    <div className="space-y-3">
      <ClassWorkspaceHeader workspace={data} activeTab={tab} onTabChange={setTab} onNavigate={onNavigate} onRefresh={onRefresh} refreshing={refreshing || workspace.isFetching} />
      {tab === 'overview' ? (
        <OverviewTab
          workspace={data}
          onOpenAssignment={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })}
          onCheckEssays={(assignmentId, studentId) => onNavigate({ screen: 'essay-check', courseId, assignmentId, studentId })}
          onOpenClasswork={() => setTab('classwork')}
          onOpenPeople={() => setTab('people')}
        />
      ) : tab === 'classwork' ? (
        <Classwork
          workspace={data}
          onOpenAssignment={(assignmentId) => onNavigate({ screen: 'assignment-detail', courseId, assignmentId })}
        />
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
  const people = workspace.people.slice(0, 5)
  const firstAssignment = workspace.assignments[0]
  const firstSubmission = firstAssignment
    ? workspace.submissions.find((submission) => submission.assignmentId === firstAssignment.id && submission.state !== 'missing' && submission.attachments.length > 0)
    : undefined

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_368px]">
      <div className="space-y-3">
        <Card className="space-y-4 p-4">
          <div><h2 className="text-[14px] font-semibold">Course overview</h2><p className="mt-2 text-[11px] leading-[16px] text-ink-muted">{workspace.description}</p></div>
          <div className="grid grid-cols-2 gap-y-3 text-[11px] text-ink-muted sm:grid-cols-4">
            <span>{workspace.course.studentCount} students</span><span>{stats.classworkCount} assignments</span><span>{workspace.topics.length} topics</span><span>{workspace.course.announcementCount} announcements</span>
          </div>
          <p className="border-t border-border-subtle pt-2 text-[10px] text-ink-muted">Teacher {workspace.course.teacherName} · Section {workspace.course.section} · Updated just now</p>
        </Card>

        <Card className="min-h-[192px] space-y-3 p-4">
          <div className="flex items-center justify-between"><h2 className="text-[14px] font-semibold">Classwork</h2><button type="button" onClick={onOpenClasswork} className="text-[10px] font-medium text-accent hover:underline">View all <span aria-hidden="true">→</span></button></div>
          {firstAssignment ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-canvas p-3">
            <button type="button" onClick={() => onOpenAssignment(firstAssignment.id)} className="min-w-0 flex-1 text-left hover:text-accent"><span className="block truncate text-[12px] font-semibold">{firstAssignment.title}</span><span className="mt-1 block text-[10px] text-ink-muted">Due {firstAssignment.dueAt} · {firstAssignment.submittedCount} of {firstAssignment.enrolledCount} submitted</span></button>
            <span className="shrink-0 text-right text-[10px] text-supports">{firstAssignment.returnedCount} returned<br /><span className="text-insufficient">{firstAssignment.pendingReviewCount} to review</span></span>
            <Button type="button" className="shrink-0" disabled={!firstSubmission} onClick={() => firstSubmission && onCheckEssays(firstAssignment.id, firstSubmission.studentId)}>Check essays</Button>
          </div> : <p className="text-[11px] text-ink-muted">No classwork yet.</p>}
          <p className="text-[10px] text-ink-muted">Submission and grade status is read from Classroom.</p>
        </Card>

        <Card className="min-h-[132px] space-y-2 p-4">
          <h2 className="text-[14px] font-semibold">Latest announcement</h2>
          {workspace.latestAnnouncement ? <><p className="text-[12px] font-medium">{workspace.latestAnnouncement.title}</p><p className="text-[10px] text-ink-muted">Posted by {workspace.latestAnnouncement.postedBy} · {workspace.latestAnnouncement.postedAt}</p><p className="text-[11px] leading-4 text-ink-muted">{workspace.latestAnnouncement.body}</p></> : <p className="text-[11px] text-ink-muted">No announcements yet.</p>}
        </Card>
      </div>

      <div className="space-y-3">
        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">People</h2><span className="text-[9px] text-ink-muted">{workspace.course.studentCount} students</span></div>
          <div className="flex items-center gap-1.5">{people.map((person) => <InitialAvatar key={person.id} initials={person.initials} className="size-6 text-[8px]" />)}<span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[10px] text-accent">+</span></div>
          <p className="text-[9px] text-ink-muted">{workspace.course.teacherName} · Teacher</p>
          <button type="button" onClick={onOpenPeople} className="text-[10px] text-accent hover:underline">Full roster in People <span aria-hidden="true">→</span></button>
        </Card>

        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Materials</h2><span className="text-[9px] text-ink-muted">{workspace.course.linkedFileCount} linked</span></div>
          <div className="space-y-1.5">{workspace.materials.slice(0, 3).map((material) => <div key={material.id} className="flex items-center gap-2 text-[10px]"><FileText className="size-3 shrink-0 text-ink-muted" /><span className="truncate">{material.title}</span>{!material.accessible && <AlertCircle className="size-3 shrink-0 text-insufficient" />}</div>)}</div>
          <p className="text-[9px] leading-3 text-ink-muted">Materials tab shows Drive availability.</p>
        </Card>

        <Card className="space-y-2 p-3"><h2 className="text-[13px] font-semibold">Topics</h2>{workspace.topics.slice(0, 3).map((topic) => <p key={topic.id} className="text-[10px] text-ink-muted">{topic.name} · {topic.assignmentCount} classwork items</p>)}</Card>
        <Card className="space-y-2 p-3"><h2 className="text-[13px] font-semibold">Grades &amp; submissions</h2><p className="text-[10px]">{stats.returned} returned · {stats.submissions - stats.returned} pending</p><p className="text-[9px] text-ink-muted">Read only · from Classroom</p></Card>
      </div>
    </div>
  )
}
