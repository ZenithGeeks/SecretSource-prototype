/**
 * 11 Library (Researcher) — project-first. The Library opens on the user's projects; opening
 * one shows that project's papers, all from the user's own analyses. Analysed papers that are
 * in no project are listed under "Unsorted". "Add paper" in a project picks from the user's
 * analysed papers; in Unsorted it hands off to History, where a paper is analysed.
 */

import { AnimatePresence } from 'framer-motion'
import { Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ToolbarActions } from '../../../components/AppShell'
import {
  BackLink,
  ConfirmDialog,
  DialogPanel,
  LibraryHeader,
  LibraryTitle,
  NewProjectDialog as SharedNewProjectDialog,
  Modal,
  LibraryCard,
  ProjectMenu,
  ProjectName,
} from '../../../components/library'
import {
  Button,
  ErrorState,
  FadeIn,
  Input,
  LoadingScreen,
  Segmented,
  Textarea,
} from '../../../components/ui'
import { paperName } from '../../../lib/api'
import { errorMessage } from '../../../lib/author'
import type { ClaimStanding, ClaimTally, LibraryPaper, Project } from '../../../lib/researcher'
import { updatedText } from '../../../lib/researcher'
import { useAnalyses } from '../../../lib/useAnalysis'
import { useProjects, useResearcherActions, useResearcherLibrary } from '../../../lib/useResearcher'
import { askTarget } from '../../../lib/askCursor'
import { useSlashFocus } from '../../../lib/useSlashFocus'
import { cn } from '../../../lib/utils'
import { LibraryAddMenu, type LibraryAddItem } from '../components/LibraryAddMenu'
import { count } from '../components/LibraryCount'
import { LibraryPaperTable } from '../components/LibraryPaperTable'
import { StandingKey } from '../components/StandingKey'

/** Display order + colour for a project's claim tally bar: worst first, as on Home and the Graph key. */
const STANDINGS: { key: ClaimStanding; color: string }[] = [
  { key: 'contradicted', color: 'bg-refutes' },
  { key: 'silent', color: 'bg-insufficient' },
  { key: 'backed', color: 'bg-supports' },
  { key: 'unchecked', color: 'bg-neutral' },
]

/** How long the Undo toast after deleting a project stays up. */
const UNDO_MS = 10_000


function TallyBar({ tally }: { tally: ClaimTally }) {
  const total = STANDINGS.reduce((sum, s) => sum + tally[s.key], 0)
  if (!total) return null
  return (
    <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded">
      {STANDINGS.map(({ key, color }) => (
        <span key={key} className={cn('h-full rounded-sm', color)} style={{ flexGrow: tally[key] }} />
      ))}
    </div>
  )
}


function ProjectCard({
  project,
  otherNames,
  onOpen,
  onRename,
  onRequestDelete,
}: {
  project: Project
  /** Names of the other projects, so a rename cannot copy one. */
  otherNames: string[]
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => Promise<unknown>
  onRequestDelete: (project: Project) => void
}) {
  const meta = project.unsorted
    ? `${count(project.papers, 'paper')} · not in a project yet`
    : `${count(project.papers, 'paper')} · ${count(project.claims, 'claim')}`
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(project.name)
  // What is in the field right now, readable by a blur that fires while the field is being removed.
  const typed = useRef(project.name)
  const [saving, setSaving] = useState(false)

  const cancelRename = () => {
    setRenaming(false)
    setDraft(project.name)
    typed.current = project.name
  }
  const submitRename = async () => {
    // Enter and the blur it can cause both land here; the second one must not save twice.
    if (saving) return
    const name = typed.current.trim()
    if (!name || name === project.name) return cancelRename()
    if (otherNames.some((other) => other.toLowerCase() === name.toLowerCase())) {
      // Stay in the field so the name can be changed.
      toast.error(`A project called "${name}" already exists. Choose another name.`)
      return
    }
    setSaving(true)
    try {
      await onRename(project.id, name)
      setRenaming(false)
    } catch {
      toast.error('Could not rename the project. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <LibraryCard
      openLabel={`Open ${project.name}, ${meta}`}
      onOpen={() => onOpen(project.id)}
      title={
        renaming ? (
          // Just the input: Enter or leaving the field saves, Escape cancels. Tabbing away used to
          // throw the edit away.
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submitRename()
            }}
            className="pointer-events-auto"
          >
            <input
              autoFocus
              aria-label="Project name"
              value={draft}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value)
                typed.current = event.target.value
              }}
              onKeyDown={(event) => event.key === 'Escape' && cancelRename()}
              onBlur={() => void submitRename()}
              className="w-full min-w-0 rounded-lg border border-accent bg-canvas px-2.5 py-1.5 font-serif text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
            />
          </form>
        ) : (
          <ProjectName>{project.name}</ProjectName>
        )
      }
      meta={meta}
      bar={<TallyBar tally={project.tally} />}
      footer={updatedText(project)}
      menu={
        !project.unsorted &&
        !renaming && <ProjectMenu label="Project actions" onRename={() => setRenaming(true)} onDelete={() => onRequestDelete(project)} />
      }
    />
  )
}

/** "Delete project?" (Figma: Library — Delete project (confirm)). Only the project is removed;
 * its papers fall back to Unsorted, the same way an unfiled paper always has. */
function DeleteProjectDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmDialog
      title={`Delete "${project.name}"?`}
      confirmLabel="Delete project"
      onCancel={onCancel}
      onConfirm={onConfirm}
      onError={() => toast.error('Could not delete the project. Try again.')}
    >
      Its {count(project.papers, 'paper')} move back to Unsorted. No paper is deleted. The project itself can't be brought back.
    </ConfirmDialog>
  )
}

/** The ways to start a new analysis. Both open Analyses, where a DOI, arXiv ID, link or PDF starts one. */
function analyseItems(onAddPaper?: () => void): LibraryAddItem[] {
  if (!onAddPaper) return []
  return [
    { label: 'Analyze a new paper', hint: 'DOI, arXiv ID, link or PDF', onSelect: onAddPaper },
  ]
}

type ProjectSort = 'updated' | 'name' | 'papers'
const SORTS: { key: ProjectSort; label: string }[] = [
  { key: 'updated', label: 'Recent' },
  { key: 'name', label: 'Name' },
  { key: 'papers', label: 'Papers' },
]

function ProjectsLanding({
  projects,
  onOpen,
  onNew,
  onAddPaper,
}: {
  projects: Project[]
  onOpen: (id: string) => void
  onNew: () => void
  onAddPaper?: () => void
}) {
  const papers = projects.reduce((sum, p) => sum + p.papers, 0)
  const claims = projects.reduce((sum, p) => sum + p.claims, 0)
  const { renameProject, deleteProject, restoreProject } = useResearcherActions()
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSort>('updated')
  const filterInput = useRef<HTMLInputElement>(null)
  useSlashFocus(filterInput)

  // Unsorted is a system bucket, not a project someone named or organized: it is left out of
  // the filter/sort and always stays last, the same place it always has been.
  const unsorted = projects.find((p) => p.unsorted)
  const q = query.trim().toLowerCase()
  const shown = projects
    .filter((p) => !p.unsorted)
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'papers') return b.papers - a.papers
      return new Date(b.updated).getTime() - new Date(a.updated).getTime()
    })
  const visible = unsorted ? [...shown, unsorted] : shown

  return (
    <>
      <ToolbarActions>
        <LibraryAddMenu items={analyseItems(onAddPaper)} />
      </ToolbarActions>
      <LibraryHeader
        eyebrow={`${count(papers, 'paper')} · ${count(claims, 'claim')}`}
        title={<LibraryTitle>Library</LibraryTitle>}
        description="Group the papers you analysed into projects."
        actions={
          <Button variant="ghost" onClick={onNew} className="border border-border-subtle">
            <Plus className="size-4" />
            New project
          </Button>
        }
      />

      {projects.filter((p) => !p.unsorted).length >= 2 && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            ref={filterInput}
            aria-keyshortcuts="/"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects (press /)"
            aria-label="Filter projects"
            className="max-w-xs rounded-[10px] bg-surface px-3 py-2 text-[13px]"
          />
          <Segmented
            label="Sort projects"
            options={SORTS.map(({ key, label }) => ({ value: key, label }))}
            value={sort}
            onChange={setSort}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* A name filter with no real-project match still leaves Unsorted and "+ New project"
            on screen — this replaces only the real-project cards, never the whole grid. */}
        {q && shown.length === 0 && (
          <p className="text-sm text-ink-muted sm:col-span-2">No project matches "{query}".</p>
        )}
        {visible.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            otherNames={projects.filter((other) => other.id !== p.id).map((other) => other.name)}
            onOpen={onOpen} onRename={renameProject} onRequestDelete={setDeleting} />
        ))}
      </div>

      <AnimatePresence>
        {deleting && (
          <DeleteProjectDialog
            project={deleting}
            onCancel={() => setDeleting(null)}
            onConfirm={async () => {
              const { id, name } = deleting
              await deleteProject(id)
              setDeleting(null)
              // The gateway keeps the project for a while, so a wrong click can be undone.
              toast.message(`Deleted "${name}"`, {
                duration: UNDO_MS,
                action: {
                  label: 'Undo',
                  onClick: () => restoreProject(id).catch(() => toast.error(`Could not bring back "${name}". Try again.`)),
                },
              })
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/** Pick analysed papers to put in a project. Only finished analyses not already in it. */
function AddPapersDialog({
  projectId,
  inProject,
  onClose,
}: {
  projectId: string
  inProject: Set<string>
  onClose: () => void
}) {
  const analyses = useAnalyses().data ?? []
  const { addToProject } = useResearcherActions()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const titleId = useId()
  const choices = analyses.filter((a) => a.status === 'done' && !inProject.has(a.id))
  const nameOf = (a: (typeof choices)[number]) => a.title || paperName(a.file ?? a.paper)
  const allChosen = choices.length > 0 && choices.every((a) => chosen.has(a.id))

  const toggle = (id: string) =>
    setChosen((now) => {
      const next = new Set(now)
      if (!next.delete(id)) next.add(id)
      return next
    })

  // One call per paper, one after the other, so a failure on one does not stop the rest. The ones
  // that failed stay chosen, ready for another try.
  const addChosen = async () => {
    setAdding(true)
    const failed: typeof choices = []
    for (const analysis of choices.filter((a) => chosen.has(a.id))) {
      try {
        await addToProject(projectId, analysis.id)
      } catch {
        failed.push(analysis)
      }
    }
    setChosen(new Set(failed.map((a) => a.id)))
    if (failed.length > 0) toast.error(`Could not add ${failed.map(nameOf).join(', ')}. Try again.`)
    setAdding(false)
  }

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <DialogPanel className="flex max-h-[80vh] w-[520px] flex-col">
        <h2 id={titleId} className="type-title text-ink">Add papers</h2>
        <p className="mt-1 text-[13px] text-ink-muted">Choose the papers you have analysed. Analyse a new one in Analyses first.</p>
        <ul className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {choices.length === 0 && (
            <li className="py-3 text-sm text-ink-muted">
              {analyses.some((a) => a.status === 'done')
                ? 'Every analysed paper is already in this project.'
                : 'No paper is analysed yet. Analyse one in Analyses first.'}
            </li>
          )}
          {choices.map((analysis) => (
            <li key={analysis.id} className="border-t border-border-subtle first:border-t-0">
              <label className="flex items-center gap-3 py-2.5 pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={chosen.has(analysis.id)}
                  disabled={adding}
                  onChange={() => toggle(analysis.id)}
                  className="size-4"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{nameOf(analysis)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-end gap-2">
          {choices.length > 1 && (
            <Button
              variant="ghost"
              disabled={adding}
              onClick={() => setChosen(allChosen ? new Set() : new Set(choices.map((a) => a.id)))}
              className="mr-auto"
            >
              {allChosen ? 'Clear' : 'Select all'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button disabled={adding || chosen.size === 0} onClick={() => void addChosen()}>
            <Plus className="size-4" />
            {adding ? 'Adding…' : chosen.size ? `Add ${count(chosen.size, 'paper')}` : 'Add'}
          </Button>
        </div>
      </DialogPanel>
    </Modal>
  )
}

/** Whether a paper shows under a filter segment: "All", "Unverified", "Conflicts" or a cluster name. */
function inFilter(paper: LibraryPaper, filter: string) {
  if (filter === 'All') return true
  if (filter === 'Unverified') return paper.backed === null
  if (filter === 'Conflicts') return (paper.contradicted ?? 0) > 0
  return paper.cluster === filter
}

function ProjectDetail({
  projectId,
  projectName,
  unsorted,
  onBack,
  onAddPaper,
  onOpenAnalysis,
}: {
  projectId: string
  projectName: string
  unsorted: boolean
  onBack: () => void
  onAddPaper?: () => void
  onOpenAnalysis: (id: string) => void
}) {
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [picking, setPicking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const filterInput = useRef<HTMLInputElement>(null)
  useSlashFocus(filterInput)
  const { data: library, isError, error, refetch } = useResearcherLibrary(projectId)
  if (isError) {
    return (
      <>
        <BackLink label="Projects" onClick={onBack} />
        <ErrorState title="This project could not load" message={errorMessage(error)} onRetry={() => refetch()} />
      </>
    )
  }
  if (!library) return <LoadingScreen label="Loading this project…" />
  const hasClusters = library.papers.some((p) => p.cluster)
  const notAnalyzed = library.papers.filter((p) => p.backed === null).length
  const withConflicts = library.papers.filter((p) => (p.contradicted ?? 0) > 0).length
  const checked = library.papers.reduce((sum, p) => sum + (p.backed === null ? 0 : p.claims), 0)
  const claimTotal = library.papers.reduce((sum, p) => sum + p.claims, 0)

  // The filter keys are the gateway's ("All", "Unverified", cluster names); the words are ours.
  // "Has conflicts" sits right after "All", as designed.
  const countFor = (key: string) => {
    if (key === 'All') return library.papers.length
    if (key === 'Unverified') return notAnalyzed
    return library.papers.filter((p) => p.cluster === key).length
  }
  const [first, ...others] = library.clusters
  const segments = [
    ...(first === undefined ? [] : [{ key: first, label: first, n: countFor(first) }]),
    { key: 'Conflicts', label: 'Has conflicts', n: withConflicts },
    ...others.map((key) => ({ key, label: key === 'Unverified' ? 'Not analyzed' : key, n: countFor(key) })),
  ]

  const q = query.trim().toLowerCase()
  const shown = library.papers
    .filter((p) => inFilter(p, filter))
    .filter((p) => q === '' || `${p.title} ${p.cite} ${p.cluster} ${p.linked.join(' ')}`.toLowerCase().includes(q))

  const items: LibraryAddItem[] = [
    ...(unsorted
      ? []
      : [{ label: 'From your analysed papers', hint: 'Pick papers already analysed', onSelect: () => setPicking(true) }]),
    ...analyseItems(onAddPaper),
  ]

  return (
    <FadeIn className="flex flex-col gap-6">
      <ToolbarActions>
        <LibraryAddMenu items={items} />
      </ToolbarActions>
      <BackLink label="Projects" trail={projectName} onClick={onBack} />
      <LibraryHeader
        eyebrow={`${count(library.papers.length, 'paper')} · ${count(claimTotal, 'claim')} · ${checked} checked`}
        title={<LibraryTitle>{projectName}</LibraryTitle>}
        description={library.summary}
      />
      <AnimatePresence>
        {picking && (
          <AddPapersDialog
            projectId={projectId}
            inProject={new Set(library.papers.map((p) => p.id))}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          ref={filterInput}
          aria-keyshortcuts="/"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter papers (press /)"
          aria-label="Filter papers"
          data-ask-target={askTarget({ kind: 'field', id: 'library-filter' })}
          className="max-w-xs rounded-[10px] bg-surface px-3 py-2 text-[13px]"
        />
        {/* Cluster names come from the papers, so there can be many: let the group wrap. */}
        <Segmented
          label="Show papers"
          options={segments.map(({ key, label, n }) => ({ value: key, label: `${label} ${n}` }))}
          value={filter}
          onChange={setFilter}
          className="flex-wrap"
        />
      </div>

      <StandingKey />

      <LibraryPaperTable
        papers={shown}
        hasClusters={hasClusters}
        limit={7}
        expanded={expanded || filter !== 'All' || q !== ''}
        onExpand={() => setExpanded(true)}
        onOpen={onOpenAnalysis}
        emptyText={library.papers.length === 0 ? 'No papers in this project yet.' : 'No papers match.'}
      />
    </FadeIn>
  )
}

/** The "New project" modal (Figma: New project modal): a name, which no other project may
 * have, and an optional description. */
function NewProjectDialog({
  existing,
  onCancel,
  onCreate,
}: {
  existing: string[]
  onCancel: () => void
  /** Resolves once the project exists; a throw keeps the dialog open with the typed name. */
  onCreate: (name: string, description: string) => Promise<void>
}) {
  const [description, setDescription] = useState('')
  const descriptionId = useId()
  return (
    <SharedNewProjectDialog
      hint="Group papers into their own library and graph. You can move papers between projects any time."
      placeholder="e.g. Retrieval survey"
      existing={existing}
      required
      onCancel={onCancel}
      onCreate={async (name) => {
        try {
          await onCreate(name, description.trim())
        } catch {
          toast.error('Could not create the project. Try again.')
        }
        return null
      }}
    >
      <label htmlFor={descriptionId} className="mt-4 block text-[13px] font-medium text-ink">Description (optional)</label>
      <Textarea
        id={descriptionId}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What is this project about?"
        rows={3}
        className="mt-1.5 resize-none"
      />
    </SharedNewProjectDialog>
  )
}

export function Library({
  onAddPaper,
  onOpenAnalysis,
}: {
  onAddPaper?: () => void
  onOpenAnalysis: (id: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('project'),
  )
  const [showNew, setShowNew] = useState(
    () => new URLSearchParams(window.location.search).get('new') === '1',
  )
  const { data: projects, isError, error, refetch } = useProjects()
  const { createProject } = useResearcherActions()
  // Opening or leaving a project adds a history entry, so the browser's Back button leaves it too.
  const openProject = (id: string | null) => {
    const params = new URLSearchParams(window.location.search)
    if (id) params.set('project', id)
    else params.delete('project')
    window.history.pushState(null, '', `?${params}`)
    setOpenId(id)
  }
  useEffect(() => {
    const onPop = () => setOpenId(new URLSearchParams(window.location.search).get('project'))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  if (isError) {
    return (
      <>
        <LibraryTitle>Library</LibraryTitle>
        <ErrorState title="Your library could not load" message={errorMessage(error)} onRetry={() => refetch()} />
      </>
    )
  }
  if (!projects) return <LoadingScreen label="Loading your projects…" />

  if (openId) {
    const project = projects.find((p) => p.id === openId)
    return (
      <ProjectDetail
        projectId={openId}
        projectName={project?.name ?? 'Project'}
        unsorted={Boolean(project?.unsorted)}
        onBack={() => openProject(null)}
        onAddPaper={onAddPaper}
        onOpenAnalysis={onOpenAnalysis}
      />
    )
  }
  return (
    <FadeIn className="flex flex-col gap-6">
      <ProjectsLanding projects={projects} onOpen={openProject} onNew={() => setShowNew(true)} onAddPaper={onAddPaper} />
      <AnimatePresence>
        {showNew && (
          <NewProjectDialog
            existing={projects.map((p) => p.name)}
            onCancel={() => setShowNew(false)}
            onCreate={async (name, description) => {
              const id = await createProject(name, description)
              setShowNew(false)
              openProject(id)
            }}
          />
        )}
      </AnimatePresence>
    </FadeIn>
  )
}
