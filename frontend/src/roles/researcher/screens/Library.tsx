/**
 * 11 Library (Researcher) — project-first. The Library opens on the user's projects; opening
 * one shows that project's papers, all from the user's own analyses. Analysed papers that are
 * in no project are listed under "Unsorted". "Add paper" in a project picks from the user's
 * analysed papers; in Unsorted it hands off to History, where a paper is analysed.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ToolbarActions } from '../../../components/AppShell'
import { Button, Empty, FadeIn, Input, LoadingScreen } from '../../../components/ui'
import { paperName } from '../../../lib/api'
import type { ClaimStanding, ClaimTally, Project } from '../../../lib/researcher'
import { updatedText } from '../../../lib/researcher'
import { useAnalyses } from '../../../lib/useAnalysis'
import { useProjects, useResearcherActions, useResearcherLibrary } from '../../../lib/useResearcher'
import { askTarget } from '../../../lib/askCursor'
import { cn } from '../../../lib/utils'
import { LibraryAddMenu, type LibraryAddItem } from '../components/LibraryAddMenu'
import { count } from '../components/LibraryCount'
import { LibraryPaperTable } from '../components/LibraryPaperTable'

/** Display order + colour for a project's claim tally bar. */
const STANDINGS: { key: ClaimStanding; color: string }[] = [
  { key: 'backed', color: 'bg-supports' },
  { key: 'silent', color: 'bg-insufficient' },
  { key: 'contradicted', color: 'bg-refutes' },
  { key: 'unchecked', color: 'bg-ink-muted' },
]

/** The two dialogs' enter/exit: the scrim fades, the panel fades and settles in from slightly
 * smaller. Their call sites sit inside AnimatePresence, or the exit would never play. */
const BACKDROP_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
}
const PANEL_MOTION = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.15 },
}

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

/** The open "⋯" menu on a project card: Rename (switches the card into inline-edit) and
 * Delete project (hands off to the confirm dialog). Not shown for Unsorted — it is a synthetic
 * bucket, not a real project. Same click-outside/Escape pattern as ExportMenu. */
function ProjectMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={root} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project actions"
        className="flex size-7 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border-subtle bg-surface p-1 shadow-[0_8px_12px_rgba(31,20,36,0.08),0_1px_1px_rgba(31,20,36,0.04)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-accent-soft"
          >
            <Pencil className="size-4" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-refutes hover:bg-refutes-soft"
          >
            <Trash2 className="size-4" />
            Delete project
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onRename,
  onRequestDelete,
}: {
  project: Project
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => Promise<unknown>
  onRequestDelete: (project: Project) => void
}) {
  const meta = project.unsorted
    ? `${count(project.papers, 'paper')} · not in a project yet`
    : `${count(project.papers, 'paper')} · ${count(project.claims, 'claim')}`
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const [saving, setSaving] = useState(false)

  const cancelRename = () => {
    setRenaming(false)
    setDraft(project.name)
  }
  const submitRename = async () => {
    const name = draft.trim()
    if (!name || name === project.name) return cancelRename()
    setSaving(true)
    try {
      await onRename(project.id, name)
      setRenaming(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent">
      {/* The whole card opens the project; it sits under the real content (next, pointer-events-
          none) so the menu and the rename field above it can still take their own clicks. */}
      <button type="button" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`} className="absolute inset-0 rounded-xl" />

      <div className="pointer-events-none flex flex-col gap-3">
        {renaming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submitRename()
            }}
            className="pointer-events-auto flex items-center gap-1.5"
          >
            <input
              autoFocus
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && cancelRename()}
              className="w-full min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2.5 py-1.5 font-serif text-base font-semibold text-ink outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={saving}
              aria-label="Save name"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-supports-soft text-supports hover:opacity-90 disabled:opacity-50"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={cancelRename}
              disabled={saving}
              aria-label="Cancel renaming"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <p className="font-serif text-base font-semibold text-ink">{project.name}</p>
        )}
        <p className="text-[13px] text-ink-muted">{meta}</p>
        <TallyBar tally={project.tally} />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-ink-muted">{updatedText(project)}</span>
          <ChevronRight className="size-4 text-accent" />
        </div>
      </div>

      {!project.unsorted && !renaming && (
        <div className="absolute right-3 top-3">
          <ProjectMenu onRename={() => setRenaming(true)} onDelete={() => onRequestDelete(project)} />
        </div>
      )}
    </div>
  )
}

/** "Delete project?" (Figma: Library — Delete project (confirm)). Only the project is removed;
 * its papers fall back to Unsorted, the same way an unfiled paper always has. */
function DeleteProjectDialog({
  project,
  onCancel,
  onConfirm,
}: {
  project: Project
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  return (
    <div role="dialog" aria-modal="true" onKeyDown={(e) => e.key === 'Escape' && !deleting && onCancel()} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={() => !deleting && onCancel()} />
      <motion.div {...PANEL_MOTION} className="relative w-[420px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl">
        <h2 className="font-serif text-lg font-semibold text-ink">Delete "{project.name}"?</h2>
        <p className="mt-2 text-sm leading-5 text-ink-muted">
          Its {count(project.papers, 'paper')} move back to Unsorted — nothing is deleted, the project just stops
          grouping them. This can't be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="border border-border-subtle" disabled={deleting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-refutes hover:opacity-90"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true)
              try {
                await onConfirm()
              } finally {
                setDeleting(false)
              }
            }}
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

/** The ways to start a new analysis. Both open Analyses, where a DOI, arXiv ID, link or PDF starts one. */
function analyseItems(onAddPaper?: () => void): LibraryAddItem[] {
  if (!onAddPaper) return []
  return [
    { label: 'Analyze a new paper', hint: 'DOI, arXiv ID, link or PDF', onSelect: onAddPaper },
  ]
}

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
  const { renameProject, deleteProject } = useResearcherActions()
  const [deleting, setDeleting] = useState<Project | null>(null)
  return (
    <>
      <ToolbarActions>
        <LibraryAddMenu items={analyseItems(onAddPaper)} />
      </ToolbarActions>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="type-label text-accent">
            {count(papers, 'paper')} · {count(claims, 'claim')}
          </p>
          <h1 className="type-display text-ink">Library</h1>
          <p className="text-sm text-ink-muted">Group the papers you analysed into projects.</p>
        </div>
        <Button variant="ghost" onClick={onNew} className="self-start border border-border-subtle sm:self-auto">
          <Plus className="size-4" />
          New project
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={onOpen} onRename={renameProject} onRequestDelete={setDeleting} />
        ))}
        <button
          type="button"
          onClick={onNew}
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-accent p-9 text-center transition-colors hover:bg-accent-soft"
        >
          <span className="font-serif text-base font-semibold text-accent">+ New project</span>
          <span className="text-xs text-ink-muted">Start a new group of papers</span>
        </button>
      </div>

      <AnimatePresence>
        {deleting && (
          <DeleteProjectDialog
            project={deleting}
            onCancel={() => setDeleting(null)}
            onConfirm={async () => {
              await deleteProject(deleting.id)
              setDeleting(null)
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
  const [adding, setAdding] = useState<string | null>(null)
  const choices = analyses.filter((a) => a.status === 'done' && !inProject.has(a.id))

  return (
    <div role="dialog" aria-modal="true" onKeyDown={(e) => e.key === 'Escape' && onClose()} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={onClose} />
      <motion.div
        {...PANEL_MOTION}
        className="relative flex max-h-[80vh] w-[520px] max-w-full flex-col rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl"
      >
        <h2 className="type-title text-ink">Add papers</h2>
        <p className="mt-1 text-[13px] text-ink-muted">Papers you have analysed. Analyse a new one in Analyses first.</p>
        <ul className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {choices.length === 0 && <li className="py-3 text-sm text-ink-muted">Every analysed paper is already in this project.</li>}
          {choices.map((analysis) => (
            <li key={analysis.id} className="flex items-center gap-3 border-t border-border-subtle py-2.5 first:border-t-0">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {analysis.title || paperName(analysis.file ?? analysis.paper)}
              </span>
              <Button
                variant="ghost"
                disabled={adding !== null}
                onClick={async () => {
                  setAdding(analysis.id)
                  try {
                    await addToProject(projectId, analysis.id)
                  } finally {
                    setAdding(null)
                  }
                }}
              >
                <Plus className="size-4" />
                {adding === analysis.id ? 'Adding…' : 'Add'}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </motion.div>
    </div>
  )
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
  const { data: library, isError } = useResearcherLibrary(projectId)
  if (isError) return <Empty title="This project could not load" hint="Refresh the page to try again." />
  if (!library) return <LoadingScreen label="Loading this project…" />
  const hasClusters = library.papers.some((p) => p.cluster)
  const notAnalyzed = library.papers.filter((p) => p.backed === null).length
  const withConflicts = library.papers.filter((p) => (p.contradicted ?? 0) > 0).length
  const checked = library.papers.reduce((sum, p) => sum + (p.backed === null ? 0 : p.claims), 0)
  const claimTotal = library.papers.reduce((sum, p) => sum + p.claims, 0)

  // The filter keys are the gateway's ("All", "Unverified", cluster names); the words are ours.
  // "Has conflicts" sits right after "All", as designed.
  const countFor = (key: string) =>
    key === 'All'
      ? library.papers.length
      : key === 'Unverified'
        ? notAnalyzed
        : library.papers.filter((p) => p.cluster === key).length
  const [first, ...others] = library.clusters
  const segments = [
    ...(first === undefined ? [] : [{ key: first, label: first, n: countFor(first) }]),
    { key: 'Conflicts', label: 'Has conflicts', n: withConflicts },
    ...others.map((key) => ({ key, label: key === 'Unverified' ? 'Not analyzed' : key, n: countFor(key) })),
  ]

  const q = query.trim().toLowerCase()
  const shown = library.papers
    .filter((p) =>
      filter === 'All'
        ? true
        : filter === 'Unverified'
          ? p.backed === null
          : filter === 'Conflicts'
            ? (p.contradicted ?? 0) > 0
            : p.cluster === filter,
    )
    .filter((p) =>
      q === ''
        ? true
        : `${p.title} ${p.cite} ${p.cluster} ${p.linked.join(' ')}`.toLowerCase().includes(q),
    )

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
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start text-[13px]">
        <span className="font-medium text-accent hover:underline">← Projects</span>
        <span className="text-ink-muted">· {projectName}</span>
      </button>

      <header className="flex flex-col gap-2">
        <p className="type-label text-accent">
          {count(library.papers.length, 'paper')} · {count(claimTotal, 'claim')} · {checked} checked
        </p>
        <h1 className="type-display text-ink">{projectName}</h1>
        <p className="text-sm text-ink-muted">{library.summary}</p>
      </header>
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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, author or claim"
          aria-label="Filter papers"
          data-ask-target={askTarget({ kind: 'field', id: 'library-filter' })}
          className="max-w-xs rounded-[10px] bg-surface px-3 py-2 text-[13px]"
        />
        <div className="flex flex-wrap gap-0.5 rounded-[9px] bg-neutral-soft p-0.5">
          {segments.map((seg) => (
            <button
              key={seg.key}
              type="button"
              aria-pressed={filter === seg.key}
              onClick={() => setFilter(seg.key)}
              className={cn(
                'rounded-lg px-3 py-[5px] text-[13px] font-medium',
                filter === seg.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
              )}
            >
              {seg.label} {seg.n}
            </button>
          ))}
        </div>
      </div>

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

/** The "New project" modal (Figma: New project modal). Scrim + card; Esc or backdrop cancels,
 * Enter/Create submits when a name is present. */
function NewProjectDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (name: string, description: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <motion.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={onCancel} />
      <motion.form
        {...PANEL_MOTION}
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (n) onCreate(n, description.trim())
        }}
        className="relative w-[440px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl"
      >
        <h2 className="font-serif text-xl font-semibold text-ink">New project</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Group papers into their own library and graph. You can move papers between projects any time.
        </p>

        <label className="mt-4 block text-[13px] font-medium text-ink">Project name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Retrieval survey"
          className="mt-1.5 w-full"
        />

        <label className="mt-4 block text-[13px] font-medium text-ink">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
          rows={3}
          className="mt-1.5 w-full resize-none rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-accent"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Create project
          </Button>
        </div>
      </motion.form>
    </div>
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
  const { data: projects, isError } = useProjects()
  const { createProject } = useResearcherActions()
  if (isError) return <Empty title="Your library could not load" hint="Refresh the page to try again." />
  if (!projects) return <LoadingScreen label="Loading your projects…" />

  if (openId) {
    const project = projects.find((p) => p.id === openId)
    return (
      <ProjectDetail
        projectId={openId}
        projectName={project?.name ?? 'Project'}
        unsorted={Boolean(project?.unsorted)}
        onBack={() => setOpenId(null)}
        onAddPaper={onAddPaper}
        onOpenAnalysis={onOpenAnalysis}
      />
    )
  }
  return (
    <FadeIn className="flex flex-col gap-6">
      <ProjectsLanding projects={projects} onOpen={setOpenId} onNew={() => setShowNew(true)} onAddPaper={onAddPaper} />
      <AnimatePresence>
        {showNew && (
          <NewProjectDialog
            onCancel={() => setShowNew(false)}
            onCreate={async (name, description) => {
              setShowNew(false)
              setOpenId(await createProject(name, description))
            }}
          />
        )}
      </AnimatePresence>
    </FadeIn>
  )
}
