/**
 * Library (Figma 597:3631): "The sources behind your drafts. Each project keeps its own .bib,
 * PDFs and check results." Project cards, the Unsorted sources card, "+ New project" from a
 * .bib or an Overleaf .zip, then what needs attention and the sources saved to projects.
 * Opening a card shows the project detail (597:4404); `?project=` deep-links it.
 */

import { AlertCircle, ArrowRight, Bookmark, FileText, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { checkedSentence, errorMessage } from '../../../lib/author'
import { useAuthorActions, useLibrary } from '../../../lib/useAuthor'
import type { AttentionRow, Project, SavedSource } from '../../../types/draftCheck'
import { CardHead, TextLink } from '../components/CardHead'
import { copiedMessage, copyText } from '../clipboard'
import { Toast } from '../components/Toast'
import { VerdictBar } from '../components/Verdicts'
import { issues } from '../labels'
import { ProjectDetail, UNSORTED } from './ProjectDetail'

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const meta = [
    project.bibName ?? 'no .bib yet',
    count(project.entries, 'entry').replace('entrys', 'entries'),
    `${project.cited} cited`,
    project.needWork ? `${project.needWork} need work` : project.checkedAt ? 'all supported' : `${count(project.drafts, 'draft')}`,
  ]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent"
    >
      <p className="font-serif text-base font-semibold text-ink">{project.name}</p>
      <p className="text-[13px] text-ink-muted">{meta.join(' · ')}</p>
      <VerdictBar counts={project.tally} />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-ink-muted">{checkedSentence(project.checkedAt)}</span>
        <ArrowRight className="size-4 text-accent" aria-hidden="true" />
      </div>
    </button>
  )
}

const ATTENTION_ICON = { replace: AlertCircle, 'upload-pdf': FileText, remove: FileText } as const
// A contradicted citation is dealt with on Check a draft (its evidence, "Keep mine", the editor).
const ATTENTION_ACTION = { replace: 'Open draft', 'upload-pdf': 'Upload PDF', remove: 'Remove' } as const

export function Library({
  projectId,
  draftId,
  onOpenProject,
  onOpenEditor,
  onOpenDraft,
}: {
  /** `?project=`: a project's detail, "unsorted", or none for the landing. */
  projectId: string | null
  /** `?draft=`: the draft whose check history the detail opens on ("View check history"). */
  draftId?: string | null
  onOpenProject: (id: string | null) => void
  onOpenEditor: (draftId: string, file?: string, line?: number) => void
  onOpenDraft: (draftId: string) => void
}) {
  const library = useLibrary()
  const actions = useAuthorActions()
  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])
  const importInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const [pdfFor, setPdfFor] = useState<AttentionRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (projectId) {
    return (
      <ProjectDetail
        projectId={projectId}
        initialDraft={draftId ?? null}
        onBack={() => onOpenProject(null)}
        onOpenEditor={onOpenEditor}
        onOpenDraft={onOpenDraft}
      />
    )
  }

  const importFile = async (file: File) => {
    setBusy('import')
    try {
      const project = await actions.importProject(file)
      setToast(`${project.name} created from ${file.name}`)
      onOpenProject(project.id)
    } catch (error) {
      setToast(`Could not import ${file.name}: ${errorMessage(error)}`)
    } finally {
      setBusy(null)
    }
  }

  const attention = async (row: AttentionRow) => {
    if (row.kind === 'replace' && row.draftId) {
      onOpenDraft(row.draftId)
      return
    }
    if (row.kind === 'upload-pdf') {
      setPdfFor(row)
      pdfInput.current?.click()
      return
    }
    if (row.kind === 'remove' && row.projectId) {
      if (!window.confirm(`Remove ${row.key} from the project's .bib? This cannot be undone.`)) return
      setBusy(row.key)
      try {
        await actions.removeBibEntry(row.projectId, row.key)
        setToast(`${row.key} removed`)
      } catch (error) {
        setToast(`Could not remove ${row.key}: ${errorMessage(error)}`)
      } finally {
        setBusy(null)
      }
    }
  }

  const uploadPdf = async (file: File) => {
    const row = pdfFor
    setPdfFor(null)
    if (!row) return
    setBusy(row.key)
    try {
      if (row.projectId) await actions.attachProjectPdf(row.projectId, row.key, file)
      else if (row.draftId) await actions.attachPdf(row.draftId, row.key, file)
      setToast(`${file.name} attached to ${row.key}. Re-check the draft to read it.`)
    } catch (error) {
      setToast(`Could not upload ${file.name}: ${errorMessage(error)}`)
    } finally {
      setBusy(null)
    }
  }

  const savedAction = async (source: SavedSource) => {
    if (!source.inBib && source.projectId) {
      setBusy(source.id)
      try {
        await actions.addSourceToBib(source.id, source.projectId)
        setToast(`${source.key} added to ${source.bibName ?? 'the .bib'}`)
      } catch (error) {
        setToast(`Could not add ${source.key}: ${errorMessage(error)}`)
      } finally {
        setBusy(null)
      }
      return
    }
    if (!source.inBib && !source.projectId) {
      const projects = library.data?.projects ?? []
      if (projects.length === 0) {
        setToast('Create a project first, then add the entry to its .bib')
        return
      }
      const choice = projects.length === 1 ? projects[0] : projects.find((p) => p.name === window.prompt(`Add to which project?\n${projects.map((p) => p.name).join('\n')}`, projects[0].name))
      if (!choice) return
      setBusy(source.id)
      try {
        await actions.addSourceToBib(source.id, choice.id)
        setToast(`${source.key} added to ${choice.name}`)
      } catch (error) {
        setToast(`Could not add ${source.key}: ${errorMessage(error)}`)
      } finally {
        setBusy(null)
      }
      return
    }
    const ok = await copyText(`\\cite{${source.key}}`)
    setToast(copiedMessage(ok, `\\cite{${source.key}}`))
  }

  if (library.isPending) return <LoadingScreen label="Loading your library…" />
  if (library.isError) {
    return (
      <Card className="flex flex-col items-start gap-3 border-refutes text-refutes">
        <p>Could not load your library: {errorMessage(library.error)}</p>
        <Button variant="ghost" onClick={() => void library.refetch()}>
          Try again
        </Button>
      </Card>
    )
  }

  const { projects, unsorted, attention: rows, saved } = library.data

  return (
    <FadeIn className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Library</h1>
          <p className="text-sm text-ink-muted">The sources behind your drafts. Each project keeps its own .bib, PDFs and check results.</p>
        </div>
        <Button onClick={() => importInput.current?.click()} disabled={busy === 'import'} className="self-start sm:self-auto">
          <Upload className="size-4" aria-hidden="true" />
          {busy === 'import' ? 'Importing…' : 'Import .bib'}
        </Button>
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
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} onOpen={() => onOpenProject(project.id)} />
        ))}
        <button
          type="button"
          onClick={() => onOpenProject(UNSORTED)}
          className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent"
        >
          <p className="font-serif text-base font-semibold text-ink">Unsorted sources</p>
          <p className="text-[13px] text-ink-muted">
            {unsorted.sources === 0 && unsorted.drafts === 0
              ? 'Nothing unsorted'
              : [
                  unsorted.sources ? `${count(unsorted.sources, 'source')}${unsorted.pdfs ? ` · ${count(unsorted.pdfs, 'PDF')}` : ''}` : null,
                  unsorted.drafts ? `${count(unsorted.drafts, 'draft')} in no project` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-ink-muted">Sources kept outside a project land here</span>
            <ArrowRight className="size-4 text-accent" aria-hidden="true" />
          </div>
        </button>
        <button
          type="button"
          onClick={() => importInput.current?.click()}
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-accent p-9 text-center transition-colors hover:bg-accent-soft"
        >
          <span className="font-serif text-base font-semibold text-accent">+ New project</span>
          <span className="text-xs text-ink-muted">Import a .bib or an Overleaf .zip</span>
        </button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2.5" aria-labelledby="attention-title">
          <CardHead id="attention-title" title="Needs attention" aside={<span className="text-ink-muted">{count(rows.length, 'source')}</span>} />
          {rows.length === 0 ? (
            <Empty title="Nothing needs attention" hint="Contradicted citations, unreadable sources and unused entries show up here." />
          ) : (
            <ul>
              {rows.map((row) => {
                const Icon = ATTENTION_ICON[row.kind]
                return (
                  <li key={`${row.kind}-${row.projectId ?? row.draftId}-${row.key}`} className="flex items-center gap-3 border-b border-border-subtle py-2">
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
                <li key={source.id} className="flex items-center gap-3 border-b border-border-subtle py-2">
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
                  <TextLink onClick={() => void savedAction(source)} aria-disabled={busy === source.id} className="shrink-0">
                    {busy === source.id ? '…' : source.inBib ? 'Insert \\cite' : 'Add to .bib'}
                  </TextLink>
                  <TextLink
                    onClick={() => void copyText(source.bibtex).then((ok) => setToast(copiedMessage(ok, `BibTeX for ${source.key}`)))}
                    className="shrink-0"
                  >
                    Copy BibTeX
                  </TextLink>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Toast message={toast} onClose={closeToast} />
    </FadeIn>
  )
}
