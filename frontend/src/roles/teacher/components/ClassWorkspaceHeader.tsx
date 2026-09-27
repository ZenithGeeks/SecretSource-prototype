import { ExternalLink, RefreshCw } from 'lucide-react'

import type { TeacherWorkspace } from '../../../lib/teacher'
import type { WorkspaceTab } from '../../../lib/teacherSelectors'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { Breadcrumbs, WorkspaceTabs } from './TeacherUi'

export function ClassWorkspaceHeader({
  workspace,
  activeTab,
  onTabChange,
  onNavigate,
  onRefresh,
  refreshing = false,
}: {
  workspace: TeacherWorkspace
  activeTab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
  onNavigate: (route: TeacherRoute) => void
  onRefresh: () => void
  refreshing?: boolean
}) {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Classes', onClick: () => onNavigate({ screen: 'classes' }) }, { label: `${workspace.course.name} · ${workspace.course.section}` }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-[29px] font-semibold leading-[41px] text-ink">{workspace.course.name} · {workspace.course.section}</h1>
          <p className="text-[11px] leading-[15px] text-ink-muted">{workspace.course.subject} · Google Classroom mirror</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a href="https://classroom.google.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-muted hover:bg-accent-soft hover:text-accent">
            Open in Classroom <ExternalLink className="size-3" />
          </a>
          <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-muted hover:bg-accent-soft hover:text-accent disabled:opacity-60">
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />{refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>
      <WorkspaceTabs active={activeTab} onChange={onTabChange} />
    </>
  )
}
