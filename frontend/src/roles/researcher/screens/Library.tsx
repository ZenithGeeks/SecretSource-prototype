/**
 * 11 Library (Researcher) — project-first. The Library opens on the user's projects; opening
 * one shows that project's papers, all from the user's own analyses. Analysed papers that are
 * in no project are listed under "Unsorted". "Add paper" in a project picks from the user's
 * analysed papers; in Unsorted it hands off to History, where a paper is analysed.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ToolbarActions } from '../../../components/AppShell'
import {
  Button,
  ErrorState,
  FadeIn,
  IconButton,
  Input,
  LoadingScreen,
  MenuItem,
  Segmented,
  Textarea,
} from '../../../components/ui'
import { paperName } from '../../../lib/api'
import { errorMessage } from '../../../lib/author'
import { useMenuKeys } from '../../../lib/useMenuKeys'
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

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'

/** The shell of the three dialogs: a scrim that closes it, Escape, and a Tab key that stays inside
 * (aria-modal alone does not stop Tab from reaching the page behind). When it closes, focus goes
 * back to what had it before it opened. */
function Modal({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  // Read while rendering: by the time an effect runs, the dialog's autoFocus field already has focus.
  const root = useRef<HTMLDivElement>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  // After a tick: React's development StrictMode unmounts and remounts at once, which must not take focus away.
  useEffect(
    () => () => {
      setTimeout(() => {
        if (!root.current?.isConnected) opener?.focus()
      })
    },
    [opener],
  )
  // A dialog opened from a menu has nothing of its own to focus: take focus so Escape and Tab work at once.
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) root.current?.focus()
  }, [])

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') return onClose()
    if (event.key !== 'Tab') return
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
    // Shift+Tab from the dialog itself (a dialog opened from a menu starts there) would leave it too.
    const atStart = document.activeElement === stops[0] || document.activeElement === event.currentTarget
    const atEnd = document.activeElement === stops[stops.length - 1]
    if (!(event.shiftKey ? atStart : atEnd)) return
    event.preventDefault()
    stops[event.shiftKey ? stops.length - 1 : 0].focus()
  }

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={keys}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <motion.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={onClose} />
      {children}
    </div>
  )
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
 * bucket, not a real project. Click outside closes it; the keys are useMenuKeys'. */
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
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const menu = useMenuKeys(open, () => setOpen(false), root)

  return (
    <div ref={root} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur} className="pointer-events-auto relative">
      <IconButton
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project actions"
        className="size-8 pointer-coarse:size-11"
      >
        <MoreVertical className="size-4" />
      </IconButton>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border-subtle bg-surface p-1 shadow-card"
        >
          <MenuItem
            role="menuitem"
            onClick={() => {
              menu.returnFocus()
              setOpen(false)
              onRename()
            }}
            className="px-3 font-normal"
          >
            <Pencil className="size-4" />
            Rename
          </MenuItem>
          <MenuItem
            role="menuitem"
            onClick={() => {
              menu.returnFocus()
              setOpen(false)
              onDelete()
            }}
            className="px-3 font-normal text-refutes hover:bg-refutes-soft"
          >
            <Trash2 className="size-4" />
            Delete project
          </MenuItem>
        </div>
      )}
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
    <div className="relative flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent">
      {/* The whole card opens the project; it sits under the real content (next, pointer-events-
          none) so the menu and the rename field above it can still take their own clicks. */}
      <button type="button" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}, ${meta}`} className="absolute inset-0 rounded-xl" />

      <div className="pointer-events-none flex flex-col gap-3">
        {renaming ? (
          // The invisible "open project" button (above, position: absolute) paints over any
          // in-flow sibling here regardless of DOM order, so a click on a button in this form
          // never reached it — only Enter (a keyboard submit, no hit-testing) worked. Rather
          // than fight the stacking, there is just the input: Enter or leaving the field saves,
          // Escape cancels. Tabbing away used to throw the edit away.
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
  const titleId = useId()
  return (
    <Modal titleId={titleId} onClose={() => !deleting && onCancel()}>
      <motion.div {...PANEL_MOTION} className="relative w-[420px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl">
        <h2 id={titleId} className="font-serif text-lg font-semibold text-ink">Delete "{project.name}"?</h2>
        <p className="mt-2 text-sm leading-5 text-ink-muted">
          Its {count(project.papers, 'paper')} move back to Unsorted. No paper is deleted. The project itself can't
          be brought back.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          {/* Focus starts on the safe choice, so Enter right after opening cancels. */}
          <Button type="button" variant="ghost" autoFocus className="border border-border-subtle" disabled={deleting} onClick={onCancel}>
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
              } catch {
                toast.error('Could not delete the project. Try again.')
              } finally {
                setDeleting(false)
              }
            }}
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </Button>
        </div>
      </motion.div>
    </Modal>
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
  const { renameProject, deleteProject } = useResearcherActions()
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

      {projects.some((p) => !p.unsorted) && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            ref={filterInput}
            aria-keyshortcuts="/"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects by name"
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
  const titleId = useId()
  const choices = analyses.filter((a) => a.status === 'done' && !inProject.has(a.id))

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <motion.div
        {...PANEL_MOTION}
        className="relative flex max-h-[80vh] w-[520px] max-w-full flex-col rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl"
      >
        <h2 id={titleId} className="type-title text-ink">Add papers</h2>
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
                  } catch {
                    toast.error('Could not add the paper. Try again.')
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
        <button type="button" onClick={onBack} className="self-start text-[13px] font-medium text-accent hover:underline">
          ← Projects
        </button>
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
          ref={filterInput}
          aria-keyshortcuts="/"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, author or claim"
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

/** The "New project" modal (Figma: New project modal). Scrim + card; Esc or backdrop cancels,
 * Enter/Create submits when a name is present. */
function NewProjectDialog({
  existing,
  busy,
  onCancel,
  onCreate,
}: {
  /** A create is in flight: the button is off so a second click or Enter cannot make a second project. */
  busy: boolean
  /** Names already in use, so a second project cannot be given the same one. */
  existing: string[]
  onCancel: () => void
  onCreate: (name: string, description: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const n = name.trim()
  const taken = existing.some((other) => other.toLowerCase() === n.toLowerCase())
  const titleId = useId()
  const nameId = useId()
  const takenId = useId()
  const descriptionId = useId()
  return (
    <Modal titleId={titleId} onClose={onCancel}>
      <motion.form
        {...PANEL_MOTION}
        onSubmit={(e) => {
          e.preventDefault()
          if (n && !taken && !busy) onCreate(n, description.trim())
        }}
        className="relative w-[440px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl"
      >
        <h2 id={titleId} className="font-serif text-xl font-semibold text-ink">New project</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Group papers into their own library and graph. You can move papers between projects any time.
        </p>

        <label htmlFor={nameId} className="mt-4 block text-[13px] font-medium text-ink">Project name</label>
        <Input
          id={nameId}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Retrieval survey"
          aria-invalid={taken}
          aria-describedby={taken ? takenId : undefined}
          className="mt-1.5 w-full"
        />
        {taken && (
          <p id={takenId} role="alert" className="mt-1.5 text-[13px] text-refutes">
            A project called "{n}" already exists. Choose another name.
          </p>
        )}

        <label htmlFor={descriptionId} className="mt-4 block text-[13px] font-medium text-ink">Description (optional)</label>
        <Textarea
          id={descriptionId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
          rows={3}
          className="mt-1.5 resize-none"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </motion.form>
    </Modal>
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
  const [creating, setCreating] = useState(false)
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
        <h1 className="type-display text-ink">Library</h1>
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
            busy={creating}
            onCancel={() => setShowNew(false)}
            onCreate={async (name, description) => {
              setCreating(true)
              try {
                const id = await createProject(name, description)
                setShowNew(false)
                openProject(id)
              } catch {
                // The dialog stays open so the typed name is not lost.
                toast.error('Could not create the project. Try again.')
              } finally {
                setCreating(false)
              }
            }}
          />
        )}
      </AnimatePresence>
    </FadeIn>
  )
}
