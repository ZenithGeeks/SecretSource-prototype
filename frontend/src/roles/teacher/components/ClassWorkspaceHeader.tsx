import type { TeacherWorkspace } from '../../../lib/teacher'
import type { WorkspaceTab } from '../../../lib/teacherSelectors'
import { WorkspaceTabs } from './TeacherUi'

export function ClassWorkspaceHeader({
  workspace,
  activeTab,
  onTabChange,
}: {
  workspace: TeacherWorkspace
  activeTab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
}) {
  const synced = workspace.course.lastSyncedAt.toLocaleLowerCase().includes('today') ? 'synced today' : 'synced recently'
  return (
    <>
      <div className="space-y-2">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-widest text-accent">{workspace.course.subject} · Section {workspace.course.section}</p>
          <h1 className="mt-1 font-serif text-[32px]/10 font-semibold text-ink">{workspace.course.name} · {workspace.course.section}</h1>
          <p className="mt-1 text-ui text-ink-muted">{workspace.course.studentCount} students · {workspace.course.assignmentCount} assignments · {synced} from Google Classroom</p>
        </div>
      </div>
      <WorkspaceTabs active={activeTab} onChange={onTabChange} />
    </>
  )
}
