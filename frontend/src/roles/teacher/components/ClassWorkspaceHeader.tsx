import { ExternalLink, RefreshCw } from 'lucide-react'

import { Button } from '../../../components/ui'
import type { TeacherWorkspace } from '../../../lib/teacher'
import type { WorkspaceTab } from '../../../lib/teacherSelectors'
import { Breadcrumbs, WorkspaceTabs } from './TeacherUi'

export function ClassWorkspaceHeader({
  workspace,
  activeTab,
  onTabChange,
  onRefresh,
  refreshing = false,
}: {
  workspace: TeacherWorkspace
  activeTab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
  onRefresh: () => void
  refreshing?: boolean
}) {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Classes' }, { label: workspace.course.name }]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{workspace.course.name}</h1>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{workspace.course.section}</span>
          </div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">{workspace.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a
            href="https://classroom.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:border-accent hover:text-accent"
          >
            Open in Classroom <ExternalLink className="size-3.5" />
          </a>
          <Button type="button" variant="ghost" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>
      <WorkspaceTabs active={activeTab} onChange={onTabChange} />
    </>
  )
}
