/**
 * "Recent projects" under the Author nav (Redesign R/Sidebar, Role=Author): the projects worked
 * on last, each with a status dot and what still needs work ("—" before its first check), and
 * "+ New", which opens the New project dialog. It reads the Library's projects, so a project created, renamed or deleted anywhere
 * shows here once the Library refetches. In the phone menu a row closes the menu
 * (`data-closes-menu`, AppShell).
 */

import { useAuthorDrafts, useLibrary } from '../../../lib/useAuthor'
import { cn } from '../../../lib/utils'
import type { Draft, Project } from '../../../types/draftCheck'
import { FOCUS, LINK } from '../hover'

/** How many rows the section shows; the rest are in the Library. */
export const RECENT_LIMIT = 5

/** When a project was last worked on: its own change, its last check, or an edit to one of its
 * drafts, whichever is latest (ISO strings compare in time order). */
function lastActivity(project: Project, drafts: Draft[]): string {
  let latest = project.updated > (project.checkedAt ?? '') ? project.updated : (project.checkedAt ?? '')
  for (const d of drafts) {
    const edited = d.edited ?? d.updated
    if (d.projectId === project.id && edited > latest) latest = edited
  }
  return latest
}

/** The dot: red while a contradicted citation needs work, amber while only partial ones do,
 * green once every citation of its last checks holds up, grey before a check or when some
 * could not be checked. */
function dot(project: Project): { className: string; label: string } {
  if (!project.checkedAt) return { className: 'bg-ink-muted', label: 'not checked yet' }
  if (project.needWork) {
    const label = `${project.needWork} need${project.needWork === 1 ? 's' : ''} work`
    return { className: project.tally.refutes ? 'bg-refutes' : 'bg-insufficient', label }
  }
  if (project.tally.unavailable || project.tally.unchecked) return { className: 'bg-ink-muted', label: project.tally.unavailable ? 'some citations could not be checked' : 'some citations not checked yet' }
  return { className: 'bg-supports', label: 'all supported' }
}

export function RecentProjects({
  activeId,
  onOpen,
  onNew,
}: {
  activeId: string | null
  onOpen: (projectId: string) => void
  /** "+ New": the New project dialog. */
  onNew: () => void
}) {
  const library = useLibrary()
  const drafts = useAuthorDrafts()

  const projects = library.data?.projects ?? []
  const recent = projects
    .map((p) => ({ project: p, at: lastActivity(p, drafts.data ?? []) }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, RECENT_LIMIT)
    .map(({ project }) => project)

  return (
    <section aria-labelledby="author-recent-projects" className="mt-5">
      <div className="mb-1 flex items-center justify-between px-2.5">
        <h2 id="author-recent-projects" className="text-[10px] font-semibold tracking-[0.1em] text-ink-muted uppercase">
          Recent projects
        </h2>
        <button
          type="button"
          onClick={onNew}
          data-closes-menu
          aria-label="New project"
          className={`text-xs font-medium text-accent ${LINK}`}
        >
          + New
        </button>
      </div>
      {recent.length ? (
        <ul aria-label="Recent projects" className="flex flex-col gap-0.5">
          {recent.map((project) => {
            const status = dot(project)
            const active = project.id === activeId
            return (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => onOpen(project.id)}
                  data-closes-menu
                  aria-current={active ? 'page' : undefined}
                  title={`${project.name} · ${status.label}`}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13px] leading-[18px] lg:py-[7px]',
                    FOCUS,
                    active ? 'bg-accent-soft font-medium text-accent' : 'text-ink hover:bg-accent-soft/60',
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className={cn('size-2 rounded-full', status.className)} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                    <span aria-hidden="true">{project.checkedAt ? project.needWork : '—'}</span>
                    <span className="sr-only">{status.label}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-2.5 text-[11px] text-ink-muted">
          {library.isPending ? 'Loading projects…' : library.isError ? 'Your projects could not load' : 'No projects yet'}
        </p>
      )}
    </section>
  )
}
