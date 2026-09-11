/**
 * 11 Library (Researcher) — project-first. The Library opens on a list of projects; opening
 * one shows that project's papers. New uploads land in the "Unsorted" project until filed.
 * Data comes from useProjects / useResearcherLibrary (mock-backed until the gateway endpoints
 * exist). "Add paper" hands off to History, where the gateway analyzes a paper.
 */

import { ChevronRight, Plus, Upload } from 'lucide-react'
import { useState } from 'react'

import { Button, Input } from '../../../components/ui'
import type { ClaimStanding, ClaimTally, Project } from '../../../lib/researcher'
import { useProjects, useResearcherActions, useResearcherLibrary } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'

/** Cluster dot colours, cycled in cluster order so new clusters stay distinguishable. */
const DOT_COLORS = ['bg-accent', 'bg-supports', 'bg-insufficient', 'bg-ink-muted', 'bg-refutes']

/** Display order + colour for a project's claim tally bar. */
const STANDINGS: { key: ClaimStanding; color: string }[] = [
  { key: 'backed', color: 'bg-supports' },
  { key: 'silent', color: 'bg-insufficient' },
  { key: 'contradicted', color: 'bg-refutes' },
  { key: 'unchecked', color: 'bg-ink-muted' },
]

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

function ProjectCard({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const meta = project.unsorted
    ? `${project.papers} papers · not filed yet`
    : `${project.papers} papers · ${project.claims} claims · ${project.clusters} clusters`
  return (
    <button
      type="button"
      onClick={() => onOpen(project.id)}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent"
    >
      <p className="font-serif text-base font-semibold text-ink">{project.name}</p>
      <p className="text-[13px] text-ink-muted">{meta}</p>
      <TallyBar tally={project.tally} />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-ink-muted">{project.updated}</span>
        <ChevronRight className="size-4 text-accent" />
      </div>
    </button>
  )
}

function ProjectsLanding({
  projects,
  onOpen,
  onNew,
}: {
  projects: Project[]
  onOpen: (id: string) => void
  onNew: () => void
}) {
  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Projects</h1>
          <p className="text-sm text-ink-muted">
            Group your papers. Each project keeps its own library and graph.
          </p>
        </div>
        <Button onClick={onNew}>
          <Plus className="size-4" />
          New project
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={onOpen} />
        ))}
        <button
          type="button"
          onClick={onNew}
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-accent p-9 text-center transition-colors hover:bg-accent-soft"
        >
          <span className="font-serif text-base font-semibold text-accent">+ New project</span>
          <span className="text-xs text-ink-muted">Start a fresh library and graph</span>
        </button>
      </div>
    </>
  )
}

function ProjectDetail({
  projectId,
  projectName,
  onBack,
  onAddPaper,
}: {
  projectId: string
  projectName: string
  onBack: () => void
  onAddPaper?: () => void
}) {
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const library = useResearcherLibrary(projectId).data
  if (!library) return null

  const clusterNames = [...new Set(library.papers.map((p) => p.cluster))]
  const dotFor = (cluster: string) => DOT_COLORS[clusterNames.indexOf(cluster) % DOT_COLORS.length]
  const q = query.trim().toLowerCase()
  const shown = library.papers
    .filter((p) =>
      filter === 'All' ? true : filter === 'Unverified' ? p.backed === null : p.cluster === filter,
    )
    .filter((p) =>
      q === ''
        ? true
        : `${p.title} ${p.cite} ${p.cluster} ${p.linked.join(' ')}`.toLowerCase().includes(q),
    )

  return (
    <>
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start text-[13px]">
        <span className="font-medium text-accent hover:underline">← Projects</span>
        <span className="text-ink-muted">· {projectName}</span>
      </button>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">{projectName}</h1>
          <p className="text-sm text-ink-muted">{library.summary}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost">
            <Upload className="size-4" />
            Import .bib
          </Button>
          <Button onClick={onAddPaper}>
            <Plus className="size-4" />
            Add paper
          </Button>
        </div>
      </header>

      {/* Search + cluster filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by meaning, e.g. “compression of token embeddings”"
          className="max-w-xl"
        />
        <div className="flex flex-wrap gap-2">
          {library.clusters.map((cluster) => (
            <button
              key={cluster}
              type="button"
              onClick={() => setFilter(cluster)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium text-ink',
                filter === cluster ? 'border-accent bg-accent-soft' : 'border-border-subtle hover:border-accent',
              )}
            >
              {cluster}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <div className="flex items-center gap-4 px-5 py-2.5 text-xs font-medium text-ink-muted">
          <span className="flex-1">Paper</span>
          <span className="w-36 shrink-0">Cluster</span>
          <span className="w-16 shrink-0">Claims</span>
          <span className="w-16 shrink-0">Backed</span>
          <span className="w-24 shrink-0">Contradicted</span>
          <span className="w-40 shrink-0">Linked to</span>
          <span className="w-6 shrink-0" />
        </div>
        {shown.map((paper) => (
          <button
            key={paper.title}
            type="button"
            className="flex w-full items-center gap-4 border-t border-border-subtle px-5 py-2.5 text-left hover:bg-accent-soft"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{paper.title}</p>
              <p className="text-xs text-ink-muted">{paper.cite}</p>
            </div>
            <span className="flex w-36 shrink-0 items-center gap-1.5 text-xs text-ink-muted">
              <span className={cn('size-2 rounded-full', dotFor(paper.cluster))} />
              {paper.cluster}
            </span>
            <span className="w-16 shrink-0 text-sm font-medium text-ink">{paper.claims}</span>
            <span className="w-16 shrink-0 text-sm font-medium text-supports">{paper.backed ?? '—'}</span>
            <span className="w-24 shrink-0 text-sm font-medium text-refutes">{paper.contradicted ?? '—'}</span>
            <span className="w-40 shrink-0 truncate text-xs text-accent">{paper.linked.join(', ')}</span>
            <ChevronRight className="size-4 shrink-0 text-ink-muted" />
          </button>
        ))}
        {shown.length === 0 && (
          <p className="border-t border-border-subtle px-5 py-6 text-sm text-ink-muted">
            No papers match.
          </p>
        )}
      </div>
    </>
  )
}

/** The "New project" modal (Figma: New project modal). Scrim + card; Esc or backdrop cancels,
 * Enter/Create submits when a name is present. Description is captured for the future endpoint. */
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
      <div className="absolute inset-0 bg-ink/45" onClick={onCancel} />
      <form
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
      </form>
    </div>
  )
}

export function Library({ onAddPaper }: { onAddPaper?: () => void }) {
  const [openId, setOpenId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('project'),
  )
  const [showNew, setShowNew] = useState(
    () => new URLSearchParams(window.location.search).get('new') === '1',
  )
  const projects = useProjects().data
  const { createProject } = useResearcherActions()
  if (!projects) return null

  if (openId) {
    const name = projects.find((p) => p.id === openId)?.name ?? 'Project'
    return (
      <ProjectDetail
        projectId={openId}
        projectName={name}
        onBack={() => setOpenId(null)}
        onAddPaper={onAddPaper}
      />
    )
  }
  return (
    <>
      <ProjectsLanding projects={projects} onOpen={setOpenId} onNew={() => setShowNew(true)} />
      {showNew && (
        <NewProjectDialog
          onCancel={() => setShowNew(false)}
          onCreate={(name) => {
            setShowNew(false)
            setOpenId(createProject(name))
          }}
        />
      )}
    </>
  )
}
