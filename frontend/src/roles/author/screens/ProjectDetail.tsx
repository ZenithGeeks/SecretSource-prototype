/**
 * Library → Project detail (Figma 597:4404): a breadcrumb back to the Library, the drafts in
 * the project, then below them at full width the check history of the selected draft — one
 * row per check run with when it finished and its counts, a "since vN" box between runs, and
 * "Compare vN with vN-1" that lists what changed citation by citation. "unsorted" shows the drafts in no project and the unsorted sources.
 */

import { AnimatePresence } from 'framer-motion'
import { Clock, FileText, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { BackLink, ConfirmDialog, LibraryHeader, LibraryTitle, ProjectMenu } from '../../../components/library'
import { Badge, Button, Card, Empty, ErrorState, FadeIn, LoadingScreen } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { checkedAtLabel, checkedLabel, editedLabel, errorMessage } from '../../../lib/author'
import { useAuthorActions, useAuthorDrafts, useAuthorProject, useCompare, useDraftChecks, useSavedSources } from '../../../lib/useAuthor'
import { useInFlight } from '../../../lib/useInFlight'
import { cn } from '../../../lib/utils'
import { labelAfterCounts, projectStatus, statusLabel, statusTone, VERDICTS } from '../../../lib/verdict'
import type { CheckDelta, CheckRun, Draft, DraftStatus, SavedSource } from '../../../types/draftCheck'
import { CardHead, TextLink } from '../components/CardHead'
import { DeleteDraftButton, DeleteDraftDialog } from '../components/DeleteDraftButton'
import { MoveDraftMenu } from '../components/MoveDraft'
import { ProjectNameField } from '../components/ProjectActions'
import { copyText, toastCopied } from '../clipboard'
import { CitationBadge } from '../components/Verdicts'
import { FOCUS, HIGHLIGHT, LINK } from '../hover'

export const UNSORTED = 'unsorted'

/** A draft's status pill: red with open issues, green when every citation is backed. */
function statusBadgeTone(status: DraftStatus) {
  const tone = statusTone(status)
  return tone === 'text-refutes' ? 'refutes' : tone === 'text-supports' ? 'supports' : 'neutral'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function countsLine(run: CheckRun): string {
  const c = run.summary.counts
  const parts = [`${run.summary.checked} citation${run.summary.checked === 1 ? '' : 's'}`]
  for (const verdict of ['supports', 'insufficient', 'refutes', 'unavailable'] as const) {
    if (c[verdict]) parts.push(`${c[verdict]} ${VERDICTS[verdict].legend}`)
  }
  return parts.join(' · ')
}

function CompareTable({ checkId, onClose }: { checkId: string; onClose: () => void }) {
  const compare = useCompare(checkId)
  if (compare.isPending) return <p className="text-xs text-ink-muted">Comparing…</p>
  if (compare.isError) return <p className="text-xs text-refutes">Could not compare: {errorMessage(compare.error)}</p>
  const { current, previous, rows } = compare.data
  const changed = rows.filter((r) => r.change !== 'same')
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          v{current.version} vs v{previous.version} · {changed.length} change{changed.length === 1 ? '' : 's'}
        </p>
        <TextLink onClick={onClose}>close</TextLink>
      </div>
      {changed.length === 0 ? (
        <p className="text-xs text-ink-muted">Every citation kept its verdict.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {changed.map((row, index) => (
            <li key={`${row.key}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-ink">\cite{'{'}{row.key}{'}'}</span>
              <span className="text-ink-muted">{row.file} L{row.line}</span>
              {row.before ? <CitationBadge verdict={row.before} /> : <span className="text-ink-muted">—</span>}
              <span aria-hidden="true">→</span>
              {row.after ? <CitationBadge verdict={row.after} /> : <span className="text-ink-muted">removed</span>}
              <span className="text-ink-muted">{row.change}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A re-check of the same text can still differ (a PDF attached, a source now readable). */
function hasChanges(delta: CheckDelta | null): boolean {
  return Boolean(delta && (delta.addedCitations !== 0 || delta.fixedIssues !== 0 || delta.newIssues !== 0))
}

/** A history row's time: exact (relative in the tooltip), or relative within the hour. */
function CheckedAt({ iso }: { iso: string | null }) {
  if (!iso) return <>{checkedLabel(iso)}</>
  const { text, title } = checkedAtLabel(iso)
  return (
    <time dateTime={iso} title={title}>
      {text}
    </time>
  )
}

function CheckHistory({ draft, runs, onOpenEditor }: { draft: Draft; runs: CheckRun[]; onOpenEditor: () => void }) {
  const [comparing, setComparing] = useState<string | null>(null)
  const done = runs.filter((r) => r.status === 'done')
  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="check-history-title">
      <CardHead
        id="check-history-title"
        title={`Check history · ${draft.title}`}
        aside={
          <TextLink onClick={onOpenEditor} data-ask-target={askTarget({ kind: 'action', id: 'open-editor' })}>
            Open in editor
          </TextLink>
        }
      />
      {done.length === 0 ? (
        <Empty title="Not checked yet" hint="Open the draft and press Re-check to record its first version." />
      ) : (
        <ul>
          {done.map((run) => (
            <li key={run.id} className="flex flex-col">
              <div data-ask-target={askTarget({ kind: 'check', id: run.id })} className="flex items-center gap-3 border-b border-border-subtle py-2">
                <Clock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">
                    v{run.version} · <CheckedAt iso={run.finishedAt} />
                  </p>
                  <p className="text-xs text-ink-muted">{countsLine(run)}</p>
                </div>
                {labelAfterCounts(run.summary) && (
                  <span className={cn('shrink-0 text-xs', statusTone(run.summary))}>{labelAfterCounts(run.summary)}</span>
                )}
              </div>
              {run.sinceLastCheck && run.previousVersion !== null && (
                <div className="my-2 flex flex-col gap-1 rounded-lg bg-canvas px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Since v{run.previousVersion}</p>
                  <p className="text-xs text-ink">
                    {run.sinceLastCheck.addedCitations >= 0 ? '+' : ''}
                    {run.sinceLastCheck.addedCitations} citation{Math.abs(run.sinceLastCheck.addedCitations) === 1 ? '' : 's'} ·{' '}
                    {run.sinceLastCheck.fixedIssues} issue{run.sinceLastCheck.fixedIssues === 1 ? '' : 's'} fixed · {run.sinceLastCheck.newIssues} new issue
                    {run.sinceLastCheck.newIssues === 1 ? '' : 's'}
                  </p>
                  {comparing === run.id ? (
                    <CompareTable checkId={run.id} onClose={() => setComparing(null)} />
                  ) : run.unchanged && !hasChanges(run.sinceLastCheck) ? (
                    <p className="text-xs text-ink-muted">No changes since the previous check</p>
                  ) : (
                    <TextLink onClick={() => setComparing(run.id)} className="self-start">
                      {run.unchanged ? 'Compare with the previous check' : `Compare v${run.version} with v${run.previousVersion}`}
                    </TextLink>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** "Delete “title”?" for a saved source, in the Library and on Unsorted. Only the source goes. */
export function DeleteSourceDialog({ source, onClose }: { source: SavedSource; onClose: () => void }) {
  const actions = useAuthorActions()
  return (
    <ConfirmDialog
      title={`Delete “${source.title}”?`}
      confirmLabel="Delete source"
      onCancel={onClose}
      onConfirm={async () => {
        await actions.deleteSource(source.id)
        toast.success(`${source.title} deleted`)
        onClose()
      }}
    >
      It leaves your saved sources. A .bib entry made from it stays. This cannot be undone.
    </ConfirmDialog>
  )
}

function UnsortedSources({ sources }: { sources: SavedSource[] }) {
  const [deleting, setDeleting] = useState<SavedSource | null>(null)
  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="unsorted-sources-title">
      <CardHead id="unsorted-sources-title" title="Unsorted sources" aside={<span className="text-ink-muted">{sources.length} saved</span>} />
      {sources.length === 0 ? (
        <Empty title="No unsorted sources" hint="Sources saved to no project land here." />
      ) : (
        <ul>
          {sources.map((source) => (
            <li key={source.id} data-ask-target={askTarget({ kind: 'source', id: source.id })} className="flex items-center gap-3 border-b border-border-subtle py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">
                  {source.authors}
                  {source.year ? ` (${source.year})` : ''} · {source.title}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {[source.pdf ? `PDF attached · ${source.pdf}` : null, source.inBib ? 'in the project .bib' : 'not in a .bib yet'].filter(Boolean).join(' · ')}
                </p>
              </div>
              <TextLink onClick={() => void copyText(source.bibtex).then((ok) => toastCopied(ok, `BibTeX for ${source.key}`))}>
                Copy BibTeX
              </TextLink>
              <button
                type="button"
                aria-label={`Delete ${source.title}`}
                onClick={() => setDeleting(source)}
                className={`rounded text-ink-muted hover:text-refutes ${HIGHLIGHT}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {deleting && <DeleteSourceDialog source={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  )
}

export function ProjectDetail({
  projectId,
  initialDraft = null,
  onBack,
  onOpenEditor,
  onDraftDeleted,
}: {
  projectId: string
  /** The draft to open the check history on; the first one otherwise. */
  initialDraft?: string | null
  onBack: () => void
  onOpenEditor: (draftId: string, file?: string, line?: number) => void
  /** A draft is gone, so the app must not keep it selected. */
  onDraftDeleted?: (draftId: string) => void
}) {
  const unsorted = projectId === UNSORTED
  const project = useAuthorProject(unsorted ? null : projectId)
  const drafts = useAuthorDrafts()
  // Unsorted lists its sources; a project counts its own for "Delete project".
  const sources = useSavedSources(unsorted ? '' : projectId)
  const actions = useAuthorActions()
  const [selectedDraft, setSelectedDraft] = useState<string | null>(initialDraft)
  const [deletingDraft, setDeletingDraft] = useState<Draft | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [deletingProject, setDeletingProject] = useState(false)
  // Unsorted drafts belong to no project, so their check history comes from the draft itself.
  const unfiled = unsorted ? (drafts.data ?? []).filter((d) => !d.projectId) : []
  const unfiledCurrent = unfiled.find((d) => d.id === selectedDraft) ?? unfiled[0]
  const unfiledChecks = useDraftChecks(unfiledCurrent?.id ?? null)

  /** "← Library · name", the Researcher's "← Projects · name". */
  const back = (trail?: string) => (
    <BackLink label="Library" trail={trail} hover={LINK} onClick={onBack} askTarget={askTarget({ kind: 'action', id: 'back-to-library' })} />
  )

  // One at a time, so a double click on New draft makes one draft.
  const creating = useInFlight()
  const newDraft = () =>
    creating.run(async () => {
      try {
        const draft = await actions.createDraft({ title: 'Untitled draft', projectId: unsorted ? null : projectId })
        onOpenEditor(draft.id, 'main.tex', 1)
      } catch (error) {
        toast.error(`Could not create the draft: ${errorMessage(error)}`)
      }
    })

  /** A deleted draft that was selected hands the selection back to the first one left. */
  const deleteDraft = async (gone: Draft) => {
    const alreadyGone = await actions.deleteDraft(gone.id)
    setDeletingDraft(null)
    if (selectedDraft === gone.id) setSelectedDraft(null)
    onDraftDeleted?.(gone.id)
    toast.success(alreadyGone ? `${gone.title} was already deleted` : `${gone.title} deleted`)
  }
  const draftDialog = (
    <AnimatePresence>
      {deletingDraft && <DeleteDraftDialog draft={deletingDraft} onCancel={() => setDeletingDraft(null)} onConfirm={() => deleteDraft(deletingDraft)} />}
    </AnimatePresence>
  )

  const newDraftButton = (
    <Button onClick={() => void newDraft()} disabled={creating.busy} data-ask-target={askTarget({ kind: 'action', id: 'new-draft' })}>
      <Plus className="size-4" aria-hidden="true" />
      New draft
    </Button>
  )
  /** The drafts, then the selected one's check history at full width (#721): side by side the
   * history was squeezed. */
  const draftsAndHistory = (list: Draft[], current: Draft | undefined, runs: CheckRun[], title: string, empty: { title: string; hint: string }) => (
    <div className="flex flex-col gap-4">
      <DraftList
        drafts={list}
        selected={current?.id ?? null}
        onSelect={setSelectedDraft}
        onOpenEditor={onOpenEditor}
        onDelete={setDeletingDraft}
        title={title}
      />
      {current ? (
        <CheckHistory draft={current} runs={runs} onOpenEditor={() => onOpenEditor(current.id)} />
      ) : (
        <Card>
          <Empty {...empty} />
        </Card>
      )}
    </div>
  )

  if (unsorted) {
    if (drafts.isPending || sources.isPending) return <LoadingScreen label="Loading unsorted sources…" />
    return (
      <FadeIn className="flex flex-col gap-6">
        {back('Unsorted sources')}
        <LibraryHeader
          eyebrow={`${plural(unfiled.length, 'draft')} · ${plural((sources.data ?? []).length, 'source')}`}
          title={<LibraryTitle>Unsorted sources</LibraryTitle>}
          description="Drafts that are in no project yet, and sources saved to no project."
          actions={newDraftButton}
        />
        {draftsAndHistory(unfiled, unfiledCurrent, unfiledChecks.data ?? [], 'Drafts in no project', {
          title: 'No drafts outside a project',
          hint: 'Every draft is in a project. Upload a .tex on Home to start one here.',
        })}
        <UnsortedSources sources={sources.data ?? []} />
        {draftDialog}
      </FadeIn>
    )
  }

  if (project.isPending) return <LoadingScreen label="Loading this project…" />
  if (project.isError) {
    return (
      <FadeIn className="flex flex-col gap-4">
        {back()}
        <ErrorState title="This project could not load" message={errorMessage(project.error)} onRetry={() => void project.refetch()} />
      </FadeIn>
    )
  }

  const detail = project.data
  const current = detail.draftList.find((d) => d.id === selectedDraft) ?? detail.draftList[0]
  const renameProject = async (name: string): Promise<string | null> => {
    try {
      await actions.updateProject(projectId, { name })
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }
  const status = projectStatus(detail)
  const meta = [
    detail.bibName ?? 'no .bib yet',
    plural(detail.entries, 'entry', 'entries'),
    `${detail.cited} cited`,
    detail.needWork
      ? `${detail.needWork} need work`
      : status.checked || status.counts.unchecked
        ? statusLabel(status)
        : detail.checkedAt
          ? 'checked, no citations'
          : 'not checked yet',
  ].join(' · ')

  return (
    <FadeIn className="flex flex-col gap-6">
      {back(detail.name)}
      <LibraryHeader
        eyebrow={plural(detail.draftList.length, 'draft')}
        title={
          renaming ? (
            <ProjectNameField name={detail.name} onSave={renameProject} onDone={() => setRenaming(false)} className="max-w-md" />
          ) : (
            <LibraryTitle>{detail.name}</LibraryTitle>
          )
        }
        description={meta}
        actions={
          <>
            {newDraftButton}
            <ProjectMenu label={`Actions for ${detail.name}`} onRename={() => setRenaming(true)} onDelete={() => setDeletingProject(true)} />
          </>
        }
      />

      {draftsAndHistory(detail.draftList, current, current ? (detail.history[current.id] ?? []) : [], 'Drafts in this project', {
        title: 'No drafts in this project',
        hint: 'Start one with + New draft, or upload a .tex on Home.',
      })}
      {draftDialog}
      <AnimatePresence>
        {deletingProject && (
          <DeleteProjectDialog
            name={detail.name}
            drafts={detail.draftList.length}
            sources={(sources.data ?? []).length}
            entries={detail.entries}
            bibName={detail.bibName}
            onCancel={() => setDeletingProject(false)}
            onConfirm={async () => {
              await actions.deleteProject(projectId)
              setDeletingProject(false)
              onBack()
            }}
          />
        )}
      </AnimatePresence>
    </FadeIn>
  )
}

/** "Delete project?": says what the gateway does. The drafts and saved sources stay and move
 * to Unsorted; the .bib and the PDFs attached to its entries go with the project. */
export function DeleteProjectDialog({
  name,
  drafts,
  sources,
  entries,
  bibName,
  onCancel,
  onConfirm,
}: {
  name: string
  drafts: number
  sources: number
  entries: number
  bibName: string | null | undefined
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <ConfirmDialog title={`Delete “${name}”?`} confirmLabel="Delete project" onCancel={onCancel} onConfirm={onConfirm}>
      <p>
        Its {plural(drafts, 'draft', 'drafts')} and {plural(sources, 'saved source', 'saved sources')} move to Unsorted.
      </p>
      <p className="mt-2">
        {bibName ?? 'Its .bib'} ({plural(entries, 'entry', 'entries')}) and the PDFs attached to it are deleted, so drafts that cite
        those keys will show them as missing. This can't be undone.
      </p>
    </ConfirmDialog>
  )
}

function DraftList({
  drafts,
  selected,
  onSelect,
  onOpenEditor,
  onDelete,
  title,
}: {
  drafts: Draft[]
  selected: string | null
  onSelect: (id: string) => void
  onOpenEditor: (id: string) => void
  /** The bin on each row: asks first. */
  onDelete: (draft: Draft) => void
  title: string
}) {
  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="project-drafts-title">
      <CardHead id="project-drafts-title" title={title} aside={<span className="text-ink-muted">{drafts.length} draft{drafts.length === 1 ? '' : 's'}</span>} />
      {drafts.length === 0 ? (
        <Empty title="No drafts yet" hint="+ New draft opens an empty one in the editor." />
      ) : (
        <ul aria-label={title}>
          {drafts.map((draft) => (
            <li key={draft.id} className="flex items-center gap-1 border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onSelect(draft.id)}
                onDoubleClick={() => onOpenEditor(draft.id)}
                aria-current={draft.id === selected ? 'true' : undefined}
                data-ask-target={askTarget({ kind: 'draft', id: draft.id })}
                className={cn('flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-2 text-left hover:bg-accent-soft/40', FOCUS, draft.id === selected && 'bg-accent-soft/60')}
              >
                <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-ink">{draft.title}</span>
                  <span className="text-xs text-ink-muted">
                    v{draft.version} · {editedLabel(draft.edited ?? draft.updated)} · {checkedLabel(draft.lastCheckedAt)}
                  </span>
                </span>
                <Badge tone={statusBadgeTone(draft.status)}>{statusLabel(draft.status)}</Badge>
              </button>
              <MoveDraftMenu draft={draft} />
              <DeleteDraftButton draft={draft} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <TextLink onClick={() => onOpenEditor(selected)} className="self-start" data-ask-target={askTarget({ kind: 'action', id: 'open-draft' })}>
          Open draft
        </TextLink>
      )}
    </Card>
  )
}
