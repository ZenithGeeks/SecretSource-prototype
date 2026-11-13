/**
 * Author Home (Redesign A1 716:4922): the greeting and one line about the draft, the latest-project
 * card with its verdict bar, "Citations that need work" beside "Bibliography", then what the design
 * does not draw but the author still needs here: the Evidence panel with the page viewer, and "Your
 * drafts". Every card reads the gateway through the useAuthor hooks, so a fix here is what the
 * editor shows next, and the other way round. The screen owns which citation is selected, the
 * toast, and the page viewer that "show in the paper" opens beside the Evidence panel.
 *
 * `draftId` comes from the URL (?draft=); with none, the most recently changed draft is picked.
 * HomeBody is keyed by it, so the selection resets when the draft changes and a toast does not.
 */

import { AnimatePresence } from 'framer-motion'
import { Loader2, Pen, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ToolbarActions } from '../../../components/AppShell'
import type { Target } from '../../../components/PageViewer'
import { PageViewer } from '../../../components/PageViewer'
import { Button, Card, ErrorState, FadeIn, LoadingScreen } from '../../../components/ui'
import { VerdictBar, VerdictLegend } from '../../../components/VerdictBar'
import { askTarget } from '../../../lib/askCursor'
import { checkedLabel, editedLabel, errorMessage } from '../../../lib/author'
import { centreInView } from '../../../lib/centreInView'
import { shortMessage } from '../../../lib/citations'
import { SETTINGS_DEFAULTS, greeting, useSettings } from '../../../lib/settings'
import { useAuth } from '../../../lib/useAuth'
import { useAuthorActions, useAuthorCheck, useAuthorDraft, useAuthorDrafts, useAuthorParse, useDraftChecks, useLibrary, useProjectLint, useStartCheck } from '../../../lib/useAuthor'
import { useInFlight } from '../../../lib/useInFlight'
import { bySeverity, isOpenIssue, settledHint } from '../../../lib/verdict'
import type { Citation, Draft } from '../../../types/draftCheck'
import { BibliographyCard } from '../components/BibliographyCard'
import { CheckProgress } from '../components/CheckProgress'
import { CitationCheckCard } from '../components/CitationCheckCard'
import { DeleteDraftDialog } from '../components/DeleteDraftButton'
import { DraftFileInputs, NewProjectMenu, NoDraftsCard } from '../components/DraftActions'
import { EvidencePanel } from '../components/EvidencePanel'
import { YourDraftsCard } from '../components/YourDraftsCard'
import type { EditorTarget } from '../editorTarget'

/** The date, the greeting and one line about the draft. */
function Greeting({ summary }: { summary: string }) {
  const { displayName } = useSettings()
  const { session } = useAuth()
  // The same precedence as AppShell's profile menu: a name chosen in Settings wins.
  const metaName = session?.user?.user_metadata?.full_name as string | undefined
  const chosenName = displayName === SETTINGS_DEFAULTS.displayName ? '' : displayName.trim()
  const firstName = (chosenName || metaName?.trim() || displayName.trim()).split(/\s+/)[0]
  const now = new Date()
  return (
    <header className="flex min-w-0 flex-col gap-2">
      <p className="type-label text-accent">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 className="type-display font-serif break-words text-ink">{greeting(firstName, now.getHours())}</h1>
      <p className="text-[15px] leading-6 break-words text-ink-muted">{summary}</p>
    </header>
  )
}

/** What the line under the greeting says: what the counts say, never more. */
function summaryOf(draft: Draft, checking: boolean): string {
  const { open } = draft.status
  if (!draft.checks) return checking ? `Checking every \\cite in ${draft.title} against its source.` : `Check ${draft.title} to verify every \\cite against its source.`
  if (open) return `${open} \\cite command${open === 1 ? '' : 's'} in ${draft.title} ${open === 1 ? 'points to a paper that doesn’t' : 'point to papers that don’t'} say what you wrote.`
  return settledHint(draft.status)
}

export function Home({
  draftId,
  onSelectDraft,
  onOpenEditor,
  onOpenHistory,
  onNewProject,
  onTargetChange,
}: {
  draftId: string | null
  /** The draft Home works on; null once the last one is deleted. */
  onSelectDraft: (id: string | null) => void
  onOpenEditor: (target: EditorTarget) => void
  /** "View check history": the draft's project in the Library. */
  onOpenHistory: (draft: Draft) => void
  /** New project ▾'s first item: the same dialog as "+ New" in Recent projects. */
  onNewProject?: () => void
  /** The page viewer opened or closed, so the shell can make room for it. */
  onTargetChange?: (open: boolean) => void
}) {
  const drafts = useAuthorDrafts()
  const actions = useAuthorActions()

  // No draft in the URL: open the most recently changed one.
  useEffect(() => {
    if (!draftId && drafts.data?.[0]) onSelectDraft(drafts.data[0].id)
  }, [draftId, drafts.data, onSelectDraft])

  const newDraft = async (title?: string, files?: { name: string; content: string }[]) => {
    try {
      const draft = await actions.createDraft({ title, files })
      onSelectDraft(draft.id)
      return draft
    } catch (error) {
      toast.error(`Could not create the draft: ${errorMessage(error)}`)
      return null
    }
  }

  const upload = async (file: File) => {
    try {
      const draft = await actions.uploadDraft(file)
      onSelectDraft(draft.id)
      toast.success(`${file.name} uploaded${file.name.toLowerCase().endsWith('.zip') ? ' — its .tex and .bib files are in the draft' : ''}. Re-check when you are ready.`)
    } catch (error) {
      toast.error(`Could not upload ${file.name}: ${errorMessage(error)}`)
    }
  }

  // "Write a draft" / "+ New draft": one at a time, so a double click makes one draft.
  const creating = useInFlight()
  const write = () =>
    void creating.run(async () => {
      const d = await newDraft('Untitled draft')
      if (d) onOpenEditor({ draftId: d.id, file: 'main.tex', line: 1 })
    })

  const addBibliography = async (file: File) => {
    const name = file.name.endsWith('.bib') ? file.name : `${file.name.replace(/\.[^.]+$/, '')}.bib`
    const text = await file.text()
    // With the list not loaded the draft in the URL still is the open one.
    const open = draftId && (!drafts.data || drafts.data.some((d) => d.id === draftId)) ? draftId : null
    try {
      if (open) {
        await actions.putFile(open, name, text)
        toast.success(`${name} added to ${drafts.data?.find((d) => d.id === open)?.title ?? 'this draft'}`)
      } else {
        const created = await newDraft(name.replace(/\.bib$/, ''), [{ name: 'main.tex', content: '' }, { name, content: text }])
        if (created) toast.success(`${name} added to a new draft`)
      }
    } catch (error) {
      toast.error(`Could not add ${name}: ${errorMessage(error)}`)
    }
  }

  const texInput = useRef<HTMLInputElement>(null)
  const bibInput = useRef<HTMLInputElement>(null)
  const pickDraft = () => texInput.current?.click()
  const pickBibliography = () => bibInput.current?.click()
  const inputs = <DraftFileInputs texInput={texInput} bibInput={bibInput} onUpload={(file) => void upload(file)} onAddBibliography={(file) => void addBibliography(file)} />

  if (drafts.isPending) return <LoadingScreen label="Loading your drafts…" />

  return (
    <>
      <ToolbarActions>
        <NewProjectMenu onNewProject={() => onNewProject?.()} onUpload={pickDraft} onWrite={write} writing={creating.busy} onAddBibliography={pickBibliography} />
      </ToolbarActions>
      {inputs}
      {drafts.isError ? (
        <ErrorState title="Could not load your drafts" message={errorMessage(drafts.error)} onRetry={() => void drafts.refetch()} />
      ) : drafts.data.length === 0 || !draftId ? (
        <FadeIn className="mx-auto flex w-full max-w-[960px] min-w-0 flex-col gap-7 pt-4">
          <Greeting summary="Upload a .tex file or write one, and every \cite gets checked against its source." />
          <NoDraftsCard onUpload={pickDraft} onWrite={write} writing={creating.busy} onAddBibliography={pickBibliography} />
        </FadeIn>
      ) : (
        <HomeBody
          key={draftId}
          draftId={draftId}
          drafts={drafts.data}
          onSelectDraft={onSelectDraft}
          onOpenEditor={onOpenEditor}
          onOpenHistory={onOpenHistory}
          onTargetChange={onTargetChange}
          onNewDraft={write}
          creatingDraft={creating.busy}
        />
      )}
    </>
  )
}

function HomeBody({
  draftId,
  drafts,
  onSelectDraft,
  onOpenEditor,
  onOpenHistory,
  onTargetChange,
  onNewDraft,
  creatingDraft,
}: {
  draftId: string
  drafts: Draft[]
  onSelectDraft: (id: string | null) => void
  onOpenEditor: (target: EditorTarget) => void
  onOpenHistory: (draft: Draft) => void
  onTargetChange?: (open: boolean) => void
  onNewDraft: () => void
  /** "+ New draft" is creating one: its link is disabled. */
  creatingDraft: boolean
}) {
  const draft = useAuthorDraft(draftId)
  const projectId = draft.data?.projectId ?? null
  // In a project the warnings are the whole project's (#714): a key another draft cites is used.
  const lint = useProjectLint(projectId)
  const parse = useAuthorParse(draft.data && !projectId ? draftId : null)
  const bibliography = projectId ? lint : parse
  const library = useLibrary()
  const latest = useAuthorCheck(draft.data?.lastCheckId ?? null)
  const running = useAuthorCheck(draft.data?.runningCheckId ?? null)
  const history = useDraftChecks(draftId)
  const start = useStartCheck()
  const actions = useAuthorActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [deleting, setDeleting] = useState<Draft | null>(null)
  const evidence = useRef<HTMLDivElement>(null)

  /** After the delete, the open draft moves to its neighbour in the list (the next one, or the
   * one before the last); with no draft left, nothing is selected and Home shows its empty
   * state. A refused delete throws: ConfirmDialog stays open with the reason. */
  const deleteDraft = async (gone: Draft) => {
    const at = drafts.findIndex((d) => d.id === gone.id)
    const neighbour = drafts[at + 1] ?? drafts[at - 1]
    const alreadyGone = await actions.deleteDraft(gone.id)
    setDeleting(null)
    toast.success(alreadyGone ? `${gone.title} was already deleted` : `${gone.title} deleted`)
    if (gone.id === draftId) onSelectDraft(neighbour?.id ?? null)
  }

  const showTarget = (next: Target | null) => {
    setTarget(next)
    onTargetChange?.(next !== null)
  }
  useEffect(() => () => onTargetChange?.(false), [onTargetChange])

  const citations = latest.data?.citations ?? []
  // Worst first, in the order "Needs work" lists them, so the pager walks the list top to bottom.
  const issues = bySeverity(citations.filter(isOpenIssue))
  // The selected row, else the first open issue — what the Evidence panel shows.
  const selected: Citation | undefined = citations.find((c) => c.id === selectedId) ?? issues[0]
  const checkId = latest.data?.id
  const isChecking = Boolean(draft.data?.runningCheckId) || start.isPending
  // The newest run failed: said until the next one starts, and after a refresh.
  const failed = !isChecking && history.data?.[0]?.status === 'error' ? history.data[0] : null

  const recheck = () => {
    if (!draft.data || isChecking) return
    start.mutate(draft.data.id, {
      onError: (error) => toast.error(`Could not start the check: ${errorMessage(error)}`),
    })
  }

  const override = async (citation: Citation, note: string) => {
    if (!draft.data || !checkId) return
    try {
      const check = await actions.overrideCitation(draft.data.id, checkId, citation, note)
      const next = bySeverity((check.citations ?? []).filter(isOpenIssue))
      setSelectedId(next[0]?.id ?? null)
      toast.success(note ? 'Kept your citation, note saved' : 'Kept your citation')
    } catch (error) {
      toast.error(`Could not save the note: ${errorMessage(error)}`)
    }
  }

  // A row or the pager picks a citation. From lg up the Evidence panel sits beside the list and
  // stays in view (sticky), so nothing moves; below it, the panel is under the list and is
  // brought to the middle of the screen once it shows that citation (its height changes with it).
  const [reveal, setReveal] = useState(0)
  useEffect(() => {
    if (!reveal) return
    const beside = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 64rem)').matches
    if (!beside) centreInView(evidence.current)
  }, [reveal])

  const nextIssue = () => {
    if (issues.length === 0) return
    const index = issues.findIndex((c) => c.id === selected?.id)
    setSelectedId(issues[(index + 1) % issues.length].id)
    setReveal((n) => n + 1)
    showTarget(null)
  }

  // The source PDF open in the evidence's place is that citation's: another pick brings the
  // evidence back rather than leave one paper showing beside another citation.
  const selectRow = (id: string) => {
    setSelectedId(id)
    setReveal((n) => n + 1)
    if (id !== selected?.id) showTarget(null)
  }

  if (draft.isPending) return <LoadingScreen label="Opening your draft…" />
  if (draft.isError) {
    const gone = errorMessage(draft.error).includes('no such draft')
    return gone ? (
      <Card className="flex flex-col items-start gap-3">
        <p className="text-ink">This draft no longer exists.</p>
        {drafts[0] && drafts[0].id !== draftId && (
          <Button variant="ghost" onClick={() => onSelectDraft(drafts[0].id)}>
            Open {drafts[0].title}
          </Button>
        )}
      </Card>
    ) : (
      <ErrorState title="Could not open this draft" message={errorMessage(draft.error)} onRetry={() => void draft.refetch()} />
    )
  }

  const current = draft.data
  const projectName = library.data?.projects.find((p) => p.id === current.projectId)?.name
  const heading = projectName ? `${projectName} · ${current.title}` : current.title
  // Nothing to say about the citations yet: not "nothing needs work".
  const notJudged: [string, string] | undefined = !current.checks
    ? ['Not checked yet', isChecking ? 'The verdicts land here as the check reads each source.' : 'Check the draft to verify every \\cite against its source.']
    : latest.isSuccess
      ? undefined
      : ['Verdicts not loaded', 'They show here once the last check loads.']
  const about = [current.files.map((f) => f.name).join(' · ') || 'no files yet', editedLabel(current.edited ?? current.updated), checkedLabel(current.lastCheckedAt)].join('  ·  ')

  return (
    <FadeIn className="mx-auto flex w-full max-w-[1120px] min-w-0 flex-col gap-7 pt-4">
      <Greeting summary={summaryOf(current, isChecking)} />

      <Card className="flex min-w-0 flex-col gap-4 rounded-2xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
            <Pen className="size-5 text-accent" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5">
            <h2 title={heading} className="truncate text-[15px] leading-5 font-semibold tracking-tight text-ink">
              {heading}
            </h2>
            <p title={about} className="truncate font-mono text-xs leading-4 whitespace-pre text-ink-muted">
              {about}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              onClick={recheck}
              disabled={isChecking}
              aria-busy={isChecking}
              data-ask-target={askTarget({ kind: 'action', id: 'check' })}
              className="border border-border-subtle px-3 py-[7px] text-[13px]"
            >
              {isChecking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
              {isChecking ? 'Checking…' : current.checks ? 'Re-check' : 'Check'}
            </Button>
            <Button
              onClick={() => onOpenEditor({ draftId: current.id })}
              data-ask-target={askTarget({ kind: 'action', id: 'open-editor' })}
              className="px-3 py-[7px] text-[13px]"
            >
              Open in editor
            </Button>
          </div>
        </div>
        <VerdictBar counts={current.status.counts} />
        <VerdictLegend counts={current.status.counts} gap="gap-x-[18px] gap-y-1" className="text-[13px]" />
      </Card>

      {running.data?.status === 'running' && <CheckProgress check={running.data} />}
      {failed && <ErrorState title="The check failed" message={shortMessage(failed.message) || 'It stopped before it finished.'} onRetry={recheck} />}
      {latest.isError && <ErrorState title="Could not load the last check" message={errorMessage(latest.error)} onRetry={() => void latest.refetch()} />}

      {/* The work: the list, and beside it (lg up, sticky) the evidence for the row picked in it,
          so a row and its evidence are on screen together. "show in the paper" puts the source
          PDF in that place; closing it brings the evidence back. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <CitationCheckCard draft={current} citations={citations} selectedId={selected?.id} onSelect={selectRow} checking={isChecking} notJudged={notJudged} />
        <div
          ref={evidence}
          className="min-w-0 scroll-mt-16 lg:sticky lg:top-16 lg:z-10 lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
        >
          {target ? (
            <PageViewer key={target.paper} target={target} onClose={() => showTarget(null)} />
          ) : (
            <EvidencePanel
              citation={selected}
              issues={issues}
              status={current.status}
              notJudged={notJudged}
              onNext={nextIssue}
              onOverride={(c, note) => void override(c, note)}
              onReopen={(c) => {
                if (checkId) void actions.reopenCitation(current.id, checkId, c).catch((error) => toast.error(`Could not reopen: ${errorMessage(error)}`))
              }}
              onAttachPdf={(c, file) =>
                void actions
                  .attachPdf(current.id, c.key, file)
                  .then(() => toast.success(`${file.name} attached to \\cite{${c.key}}. Re-check to read it.`))
                  .catch((error) => toast.error(`Could not upload ${file.name}: ${errorMessage(error)}`))
              }
              onShow={showTarget}
              onEdit={(c) => onOpenEditor({ draftId: current.id, file: c.file, line: c.line })}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <BibliographyCard
          draftId={current.id}
          parse={bibliography.data}
          error={bibliography.error}
          onRetry={() => void bibliography.refetch()}
          draftTitle={(id) => drafts.find((d) => d.id === id)?.title}
          onOpenEditor={onOpenEditor}
        />
        <YourDraftsCard drafts={drafts} currentId={current.id} onOpen={(id) => onOpenEditor({ draftId: id })} onNew={onNewDraft} creating={creatingDraft} onHistory={onOpenHistory} onDelete={setDeleting} />
      </div>

      <AnimatePresence>
        {deleting && <DeleteDraftDialog draft={deleting} onCancel={() => setDeleting(null)} onConfirm={() => deleteDraft(deleting)} />}
      </AnimatePresence>
    </FadeIn>
  )
}
