/**
 * 11 Library (Researcher) — project-first. The Library opens on the user's projects; opening
 * one shows that project's papers, all from the user's own analyses. Analysed papers that are
 * in no project are listed under "Unsorted". "Add paper" in a project picks from the user's
 * analysed papers; in Unsorted it hands off to History, where a paper is analysed.
 */

import { BarChart3, ChevronRight, Plus, Search } from 'lucide-react'
import { useState } from 'react'

import { Button, Input } from '../../../components/ui'
import { paperName } from '../../../lib/api'
import type { ClaimStanding, ClaimTally, Project } from '../../../lib/researcher'
import { updatedText } from '../../../lib/researcher'
import { useAnalyses } from '../../../lib/useAnalysis'
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

/** "1 paper", "3 papers". */
function count(number: number, noun: string) {
  return `${number} ${noun}${number === 1 ? '' : 's'}`
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const meta = project.unsorted
    ? `${count(project.papers, 'paper')} · not in a project yet`
    : `${count(project.papers, 'paper')} · ${count(project.claims, 'claim')}`
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
        <span className="text-xs text-ink-muted">{updatedText(project)}</span>
        <ChevronRight className="size-4 text-accent" />
      </div>
    </button>
  )
}

/** Field Consensus — the named entry to the cross-paper claim view (10 Field consensus). It
 * lives on the Library page, since consensus is asked across the library, and hands the typed
 * claim to the field-consensus screen. Naming it (not "Ask the field") makes the feature legible. */
function FieldConsensusCard({ onOpen }: { onOpen: (query?: string) => void }) {
  const [q, setQ] = useState('')
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-accent-soft p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <BarChart3 className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">Field Consensus</p>
          <p className="text-xs font-medium text-accent">Where your whole library stands on one claim</p>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Type a claim. Every analysed paper is sorted into supports · contradicts · silent, each with
        the deciding quote — the field&rsquo;s verdict at a glance.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onOpen(q.trim() || undefined)
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. batch normalization reduces internal covariate shift"
            className="w-full pl-9"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Check consensus
        </Button>
      </form>
    </section>
  )
}

function ProjectsLanding({
  projects,
  onOpen,
  onNew,
  onOpenConsensus,
}: {
  projects: Project[]
  onOpen: (id: string) => void
  onNew: () => void
  onOpenConsensus: (query?: string) => void
}) {
  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Library</h1>
          <p className="text-sm text-ink-muted">
            Group the papers you analysed into projects — or ask the whole library one question.
          </p>
        </div>
        <Button onClick={onNew} className="self-start sm:self-auto">
          <Plus className="size-4" />
          New project
        </Button>
      </header>

      <FieldConsensusCard onOpen={onOpenConsensus} />

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
          <span className="text-xs text-ink-muted">Start a new group of papers</span>
        </button>
      </div>
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
      <div className="absolute inset-0 bg-ink/45" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-[520px] max-w-full flex-col rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl">
        <h2 className="font-serif text-xl font-semibold text-ink">Add papers</h2>
        <p className="mt-1 text-[13px] text-ink-muted">Papers you have analysed. Analyse a new one in History first.</p>
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
      </div>
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
  const library = useResearcherLibrary(projectId).data
  if (!library) return null
  const hasClusters = library.papers.some((p) => p.cluster)

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

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">{projectName}</h1>
          <p className="text-sm text-ink-muted">{library.summary}</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <Button onClick={unsorted ? onAddPaper : () => setPicking(true)}>
            <Plus className="size-4" />
            {unsorted ? 'Analyse a paper' : 'Add paper'}
          </Button>
        </div>
      </header>
      {picking && (
        <AddPapersDialog
          projectId={projectId}
          inProject={new Set(library.papers.map((p) => p.id))}
          onClose={() => setPicking(false)}
        />
      )}

      {/* Search + cluster filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, authors and linked papers"
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
        <div className="hidden items-center gap-4 px-5 py-2.5 text-xs font-medium text-ink-muted md:flex">
          <span className="flex-1">Paper</span>
          {hasClusters && <span className="w-36 shrink-0">Cluster</span>}
          <span className="w-16 shrink-0">Claims</span>
          <span className="w-16 shrink-0">Backed</span>
          <span className="w-24 shrink-0">Contradicted</span>
          <span className="w-40 shrink-0">Linked to</span>
          <span className="w-6 shrink-0" />
        </div>
        {shown.map((paper) => (
          <button
            key={paper.id}
            type="button"
            onClick={() => onOpenAnalysis(paper.id)}
            title="Open this analysis"
            className="flex w-full items-center gap-4 border-t border-border-subtle px-4 py-3 text-left first:border-t-0 hover:bg-accent-soft md:px-5 md:py-2.5 md:first:border-t"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{paper.title}</p>
              <p className="text-xs text-ink-muted">{paper.cite}</p>
              {/* On a phone the number columns do not fit, so they read as one line here. */}
              <p className="mt-1 text-xs text-ink-muted md:hidden">
                {count(paper.claims, 'claim')}
                {paper.backed !== null && <> · <span className="text-supports">{paper.backed} backed</span></>}
                {paper.contradicted !== null && (
                  <> · <span className="text-refutes">{paper.contradicted} contradicted</span></>
                )}
                {paper.linked.length > 0 && <> · linked to {paper.linked.join(', ')}</>}
              </p>
            </div>
            {hasClusters && (
              <span className="hidden w-36 shrink-0 items-center gap-1.5 text-xs text-ink-muted md:flex">
                <span className={cn('size-2 rounded-full', dotFor(paper.cluster))} />
                {paper.cluster}
              </span>
            )}
            <span className="hidden w-16 shrink-0 text-sm font-medium text-ink md:inline">{paper.claims}</span>
            <span className="hidden w-16 shrink-0 text-sm font-medium text-supports md:inline">{paper.backed ?? '—'}</span>
            <span className="hidden w-24 shrink-0 text-sm font-medium text-refutes md:inline">{paper.contradicted ?? '—'}</span>
            <span className="hidden w-40 shrink-0 truncate text-xs text-accent md:inline">{paper.linked.join(', ')}</span>
            <ChevronRight className="size-4 shrink-0 text-ink-muted" />
          </button>
        ))}
        {shown.length === 0 && (
          <p className="border-t border-border-subtle px-5 py-6 text-sm text-ink-muted">
            {library.papers.length === 0 ? 'No papers in this project yet.' : 'No papers match.'}
          </p>
        )}
      </div>
    </>
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

export function Library({
  onAddPaper,
  onOpenAnalysis,
  onOpenConsensus,
}: {
  onAddPaper?: () => void
  onOpenAnalysis: (id: string) => void
  onOpenConsensus: (query?: string) => void
}) {
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
    <>
      <ProjectsLanding
        projects={projects}
        onOpen={setOpenId}
        onNew={() => setShowNew(true)}
        onOpenConsensus={onOpenConsensus}
      />
      {showNew && (
        <NewProjectDialog
          onCancel={() => setShowNew(false)}
          onCreate={async (name, description) => {
            setShowNew(false)
            setOpenId(await createProject(name, description))
          }}
        />
      )}
    </>
  )
}
