/**
 * Library (Figma 597:3631): "The sources behind your drafts. Each project keeps its own .bib,
 * PDFs and check results." Project cards, the Unsorted sources card, "+ New project" from a
 * .bib or an Overleaf .zip, then what needs attention and the sources saved to projects.
 * Opening a card shows the project detail (597:4404); `?project=` deep-links it.
 */

import { AnimatePresence } from 'framer-motion'
import { AlertCircle, Bookmark, FileText, Plus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog, LibraryCard, LibraryHeader, LibraryTitle, MenuButton, ProjectMenu, ProjectName } from '../../../components/library'
import { Button, Card, Empty, ErrorState, FadeIn, LoadingScreen } from '../../../components/ui'
import { VerdictBar } from '../../../components/VerdictBar'
import { askTarget } from '../../../lib/askCursor'
import { checkedSentence, errorMessage } from '../../../lib/author'
import { useAuthorActions, useLibrary } from '../../../lib/useAuthor'
import { projectStatus, statusLabel } from '../../../lib/verdict'
import type { AttentionRow, Project, SavedSource } from '../../../types/draftCheck'
import { CardHead, TextLink } from '../components/CardHead'
import { NewProjectWithDrafts } from '../components/MoveDraft'
import { ProjectNameField } from '../components/ProjectActions'
import { copyText, toastCopied } from '../clipboard'
import { issues } from '../labels'
import { DeleteProjectDialog, DeleteSourceDialog, ProjectDetail, UNSORTED } from './ProjectDetail'
import { HIGHLIGHT } from '../hover'

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** A project card on the shared Library frame: the whole card opens the project; its "⋯" menu
 * renames it in place or asks to delete it. */
function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete,
}: {
  project: Project
  onOpen: () => void
  /** Resolves to the gateway's refusal, or null when it took the name. */
  onRename: (name: string) => Promise<string | null>
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const status = projectStatus(project)
  const meta = [
    project.bibName ?? 'no .bib yet',
    count(project.entries, 'entry').replace('entrys', 'entries'),
    `${project.cited} cited`,
    project.needWork
      ? `${project.needWork} need work`
      : status.checked || status.counts.unchecked
        ? statusLabel(status)
        : `${count(project.drafts, 'draft')}`,
  ]
  return (
    <LibraryCard
      openLabel={`Open ${project.name}`}
      onOpen={onOpen}
      askTarget={askTarget({ kind: 'project', id: project.id })}
      title={
        renaming ? (
          <ProjectNameField name={project.name} onSave={onRename} onDone={() => setRenaming(false)} />
        ) : (
          <ProjectName>{project.name}</ProjectName>
        )
      }
      meta={meta.join(' · ')}
      bar={<VerdictBar counts={project.tally} />}
      footer={checkedSentence(project.checkedAt)}
      menu={!renaming && <ProjectMenu label={`Actions for ${project.name}`} onRename={() => setRenaming(true)} onDelete={onDelete} />}
    />
  )
}

const ATTENTION_ICON = { replace: AlertCircle, 'upload-pdf': FileText, remove: FileText } as const
// A contradicted citation is dealt with in the editor (its issue popover, "Keep mine").
const ATTENTION_ACTION = { replace: 'Open draft', 'upload-pdf': 'Upload PDF', remove: 'Remove' } as const

export function Library({
  projectId,
  draftId,
  onOpenProject,
  onOpenEditor,
  onDraftDeleted,
}: {
  /** `?project=`: a project's detail, "unsorted", or none for the landing. */
  projectId: string | null
  /** `?draft=`: the draft whose check history the detail opens on ("View check history"). */
  draftId?: string | null
  onOpenProject: (id: string | null) => void
  onOpenEditor: (draftId: string, file?: string, line?: number) => void
  /** A draft deleted on a project's page, so the app must not keep it selected. */
  onDraftDeleted?: (draftId: string) => void
}) {
  const library = useLibrary()
  const actions = useAuthorActions()
  const importInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const [pdfFor, setPdfFor] = useState<AttentionRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [removing, setRemoving] = useState<{ projectId: string; key: string } | null>(null)
  const [deletingSource, setDeletingSource] = useState<SavedSource | null>(null)

  if (projectId) {
    // A toast from here (a project just created or imported) stays up on the project's page:
    // the app's toaster sits above every screen.
    return (
      <ProjectDetail
        projectId={projectId}
        initialDraft={draftId ?? null}
        onBack={() => onOpenProject(null)}
        onOpenEditor={onOpenEditor}
        onDraftDeleted={onDraftDeleted}
      />
    )
  }

  /** One action on a row at a time: `key` shows that row busy, and the toast says how it went. */
  const run = async (key: string, failed: string, work: () => Promise<string>) => {
    setBusy(key)
    try {
      toast.success(await work())
    } catch (error) {
      toast.error(`${failed}: ${errorMessage(error)}`)
    } finally {
      setBusy(null)
    }
  }

  const importFile = (file: File) =>
    run('import', `Could not import ${file.name}`, async () => {
      const project = await actions.importProject(file)
      onOpenProject(project.id)
      return `${project.name} created from ${file.name}`
    })

  /** Rename on a card: resolves to the gateway's refusal, or null when it took the name. */
  const renameProject = async (projectId: string, name: string): Promise<string | null> => {
    try {
      await actions.updateProject(projectId, { name })
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }

  const attention = async (row: AttentionRow) => {
    if (row.kind === 'replace' && row.draftId) {
      onOpenEditor(row.draftId, row.file, row.line)
      return
    }
    if (row.kind === 'upload-pdf') {
      setPdfFor(row)
      pdfInput.current?.click()
      return
    }
    const { projectId } = row
    if (row.kind !== 'remove' || !projectId) return
    setRemoving({ projectId, key: row.key })
  }

  const uploadPdf = async (file: File) => {
    const row = pdfFor
    setPdfFor(null)
    if (!row) return
    await run(row.key, `Could not upload ${file.name}`, async () => {
      if (row.projectId) await actions.attachProjectPdf(row.projectId, row.key, file)
      else if (row.draftId) await actions.attachPdf(row.draftId, row.key, file)
      return `${file.name} attached to ${row.key}. Re-check the draft to read it.`
    })
  }

  const addToBib = (source: SavedSource, target: { id: string; name: string }) =>
    run(source.id, `Could not add ${source.key}`, async () => {
      await actions.addSourceToBib(source.id, target.id)
      return `${source.key} added to ${target.name}`
    })

  /** Insert \cite, or add to the source's own project, or to the only one. With several
   * projects, a source in none picks one from a menu instead. */
  const savedAction = async (source: SavedSource) => {
    if (source.inBib) {
      const ok = await copyText(`\\cite{${source.key}}`)
      toastCopied(ok, `\\cite{${source.key}}`)
      return
    }
    const target = source.projectId ? { id: source.projectId, name: source.bibName ?? 'the .bib' } : library.data?.projects[0]
    if (!target) {
      toast.warning('Create a project first, then add the entry to its .bib')
      return
    }
    await addToBib(source, target)
  }

  if (library.isPending) return <LoadingScreen label="Loading your library…" />
  if (library.isError) {
    return (
      <>
        <LibraryTitle>Library</LibraryTitle>
        <ErrorState title="Your library could not load" message={errorMessage(library.error)} onRetry={() => void library.refetch()} />
      </>
    )
  }

  const { projects, unsorted, attention: rows, saved } = library.data
  const drafts = projects.reduce((sum, p) => sum + p.drafts, 0)
  const cited = projects.reduce((sum, p) => sum + p.cited, 0)
  const unsortedMeta =
    [
      unsorted.sources ? `${count(unsorted.sources, 'source')}${unsorted.pdfs ? ` · ${count(unsorted.pdfs, 'PDF')}` : ''}` : null,
      unsorted.drafts ? `${count(unsorted.drafts, 'draft')} in no project` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing unsorted'

  return (
    <FadeIn className="flex flex-col gap-6">
      <LibraryHeader
        eyebrow={`${count(projects.length, 'project')} · ${count(drafts, 'draft')} · ${cited} cited`}
        title={<LibraryTitle>Library</LibraryTitle>}
        description="The sources behind your drafts. Each project keeps its own .bib, PDFs and check results."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => importInput.current?.click()}
              disabled={busy === 'import'}
              className="border border-border-subtle"
              data-ask-target={askTarget({ kind: 'action', id: 'import-bib' })}
            >
              <Upload className="size-4" aria-hidden="true" />
              {busy === 'import' ? 'Importing…' : 'Import .bib'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setCreating(true)}
              className="border border-border-subtle"
              data-ask-target={askTarget({ kind: 'action', id: 'new-project' })}
            >
              <Plus className="size-4" aria-hidden="true" />
              New project
            </Button>
          </>
        }
      />
      <input
        ref={importInput}
        type="file"
        accept=".bib,.zip"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a .bib or an Overleaf .zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importFile(file)
        }}
      />
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload the source PDF"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void uploadPdf(file)
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onOpen={() => onOpenProject(project.id)}
            onRename={(name) => renameProject(project.id, name)}
            onDelete={() => setDeleting(project)}
          />
        ))}
        <LibraryCard
          openLabel={`Open Unsorted sources, ${unsortedMeta}`}
          onOpen={() => onOpenProject(UNSORTED)}
          askTarget={askTarget({ kind: 'project', id: UNSORTED })}
          title={<ProjectName>Unsorted sources</ProjectName>}
          meta={unsortedMeta}
          footer="Sources kept outside a project land here"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2.5" aria-labelledby="attention-title">
          <CardHead id="attention-title" title="Needs attention" aside={<span className="text-ink-muted">{count(rows.length, 'source')}</span>} />
          {rows.length === 0 ? (
            <Empty title="Nothing needs attention" hint="Contradicted citations, unreadable sources and unused entries show up here." />
          ) : (
            <ul>
              {rows.map((row) => {
                const Icon = ATTENTION_ICON[row.kind]
                return (
                  <li
                    key={`${row.kind}-${row.projectId ?? row.draftId}-${row.key}`}
                    data-ask-target={askTarget({ kind: 'source', id: `attention-${row.kind}-${row.projectId ?? row.draftId}-${row.key}` })}
                    className="flex items-center gap-3 border-b border-border-subtle py-2"
                  >
                    <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{row.title}</p>
                      <p className="truncate text-xs text-ink-muted">{row.detail}</p>
                    </div>
                    <TextLink onClick={() => void attention(row)} aria-disabled={busy === row.key} className="shrink-0">
                      {busy === row.key ? '…' : ATTENTION_ACTION[row.kind]}
                    </TextLink>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-2.5" aria-labelledby="saved-title">
          <CardHead id="saved-title" title="Saved sources" aside={<span className="text-ink-muted">{count(saved.length, 'source')}</span>} />
          {saved.length === 0 ? (
            <Empty title="No saved sources" hint="Sources kept in a project without being in its .bib show up here." />
          ) : (
            <ul>
              {saved.map((source) => (
                <li key={source.id} data-ask-target={askTarget({ kind: 'source', id: source.id })} className="flex items-center gap-3 border-b border-border-subtle py-2">
                  <Bookmark className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {source.authors}
                      {source.year ? ` (${source.year})` : ''} · {source.title}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {[
                        source.verdict === 'supports' ? `Supports ${issues(1).replace('issue', 'claim')}` : source.openAccess ? 'Open access' : null,
                        source.inBib ? `in ${source.bibName}` : source.bibName ? `not in ${source.bibName} yet` : 'not in a project yet',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {!source.inBib && !source.projectId && projects.length > 1 ? (
                    <MenuButton
                      className="shrink-0"
                      menuClassName="max-h-64 w-56 overflow-y-auto"
                      label="Projects"
                      trigger={(open) => (
                        <TextLink {...open} aria-disabled={busy === source.id}>
                          {busy === source.id ? '…' : 'Add to .bib'}
                        </TextLink>
                      )}
                      items={projects.map((p) => ({ key: p.id, content: <span className="truncate">{p.name}</span>, onSelect: () => void addToBib(source, p) }))}
                    />
                  ) : (
                    <TextLink onClick={() => void savedAction(source)} aria-disabled={busy === source.id} className="shrink-0">
                      {busy === source.id ? '…' : source.inBib ? 'Insert \\cite' : 'Add to .bib'}
                    </TextLink>
                  )}
                  <TextLink
                    onClick={() => void copyText(source.bibtex).then((ok) => toastCopied(ok, `BibTeX for ${source.key}`))}
                    className="shrink-0"
                  >
                    Copy BibTeX
                  </TextLink>
                  <button
                    type="button"
                    aria-label={`Delete ${source.title}`}
                    onClick={() => setDeletingSource(source)}
                    className={`shrink-0 rounded text-ink-muted hover:text-refutes ${HIGHLIGHT}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <AnimatePresence>
        {creating && (
          <NewProjectWithDrafts
            onCancel={() => setCreating(false)}
            onCreated={(projectId) => {
              setCreating(false)
              onOpenProject(projectId)
            }}
            onImport={() => {
              setCreating(false)
              importInput.current?.click()
            }}
          />
        )}
        {deleting && (
          <DeleteProjectDialog
            name={deleting.name}
            drafts={deleting.drafts}
            sources={saved.filter((s) => s.projectId === deleting.id).length}
            entries={deleting.entries}
            bibName={deleting.bibName}
            onCancel={() => setDeleting(null)}
            onConfirm={async () => {
              await actions.deleteProject(deleting.id)
              toast.success(`${deleting.name} deleted`)
              setDeleting(null)
            }}
          />
        )}
        {deletingSource && <DeleteSourceDialog source={deletingSource} onClose={() => setDeletingSource(null)} />}
        {removing && (
          <ConfirmDialog
            title={`Remove ${removing.key} from the .bib?`}
            confirmLabel="Remove"
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              await actions.removeBibEntry(removing.projectId, removing.key)
              toast.success(`${removing.key} removed`)
              setRemoving(null)
            }}
          >
            The entry leaves the project's .bib. This cannot be undone.
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </FadeIn>
  )
}

