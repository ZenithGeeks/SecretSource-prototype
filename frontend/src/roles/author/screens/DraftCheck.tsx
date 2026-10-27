/**
 * Author Home: "Check a draft" (Figma 558:3647). Every card reads the gateway through the
 * useAuthor hooks, so a fix here is what the editor shows next, and the other way round.
 * The screen owns which draft and which citation are selected, the toast, and the page
 * viewer that "show in the paper" opens beside the cards.
 *
 * `draftId` comes from the URL (?draft=); with none, the most recently changed draft is
 * picked. The parent keys this component by it so selection resets when the draft changes.
 */

import { Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { Target } from '../../../components/PageViewer'
import { PageViewer } from '../../../components/PageViewer'
import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { errorMessage } from '../../../lib/author'
import { useAuthorActions, useAuthorCheck, useAuthorDraft, useAuthorDrafts, useAuthorParse, useStartCheck } from '../../../lib/useAuthor'
import { isOpenIssue } from '../../../lib/verdict'
import type { Citation, Draft } from '../../../types/draftCheck'
import { CheckProgress } from '../components/CheckProgress'
import { CitationCheckCard } from '../components/CitationCheckCard'
import { EvidencePanel } from '../components/EvidencePanel'
import { ParsedDraftCard } from '../components/ParsedDraftCard'
import { QuickActions } from '../components/QuickActions'
import { Toast } from '../components/Toast'
import { YourDraftsCard } from '../components/YourDraftsCard'
import type { EditorTarget } from '../editorTarget'

export function DraftCheck({
  draftId,
  onSelectDraft,
  onOpenEditor,
  onOpenHistory,
  onTargetChange,
}: {
  draftId: string | null
  onSelectDraft: (id: string) => void
  onOpenEditor: (target: EditorTarget) => void
  /** "View check history": the draft's project in the Library. */
  onOpenHistory: (draft: Draft) => void
  /** The page viewer opened or closed, so the shell can make room for it. */
  onTargetChange?: (open: boolean) => void
}) {
  const drafts = useAuthorDrafts()
  const actions = useAuthorActions()
  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])

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
      setToast(`Could not create the draft: ${errorMessage(error)}`)
      return null
    }
  }

  const upload = async (file: File) => {
    try {
      const draft = await actions.uploadDraft(file)
      onSelectDraft(draft.id)
      setToast(`${file.name} uploaded${file.name.toLowerCase().endsWith('.zip') ? ' — its .tex and .bib files are in the draft' : ''}. Re-check when you are ready.`)
    } catch (error) {
      setToast(`Could not upload ${file.name}: ${errorMessage(error)}`)
    }
  }

  const quickActions = (draft: Draft | null) => (
    <QuickActions
      onUpload={(file) => void upload(file)}
      onWrite={() => void newDraft('Untitled draft').then((d) => d && onOpenEditor({ draftId: d.id, file: 'main.tex', line: 1 }))}
      onAddBibliography={async (file) => {
        const name = file.name.endsWith('.bib') ? file.name : `${file.name.replace(/\.[^.]+$/, '')}.bib`
        const text = await file.text()
        try {
          if (draft) {
            await actions.putFile(draft.id, name, text)
            setToast(`${name} added to ${draft.title}`)
          } else {
            const created = await newDraft(name.replace(/\.bib$/, ''), [{ name: 'main.tex', content: '' }, { name, content: text }])
            if (created) setToast(`${name} added to a new draft`)
          }
        } catch (error) {
          setToast(`Could not add ${name}: ${errorMessage(error)}`)
        }
      }}
    />
  )

  if (drafts.isPending) return <LoadingScreen label="Loading your drafts…" />
  if (drafts.isError) {
    return (
      <Card className="flex flex-col items-start gap-3 border-refutes text-refutes">
        <p>Could not load your drafts: {errorMessage(drafts.error)}</p>
        <Button variant="ghost" onClick={() => void drafts.refetch()}>
          Try again
        </Button>
      </Card>
    )
  }

  if (drafts.data.length === 0 || !draftId) {
    return (
      <FadeIn className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Check a draft</h1>
          <p className="text-sm text-ink-muted">Upload a .tex file or write one, and every \cite gets checked against its source.</p>
        </header>
        {quickActions(null)}
        <Empty title="No drafts yet" hint="Upload a .tex or .zip, write a draft, or add a bibliography to begin." />
        <Toast message={toast} onClose={closeToast} />
      </FadeIn>
    )
  }

  return (
    <DraftCheckBody
      key={draftId}
      draftId={draftId}
      drafts={drafts.data}
      toast={toast}
      setToast={setToast}
      closeToast={closeToast}
      quickActions={quickActions}
      onSelectDraft={onSelectDraft}
      onOpenEditor={onOpenEditor}
      onOpenHistory={onOpenHistory}
      onTargetChange={onTargetChange}
      onNewDraft={() => void newDraft('Untitled draft').then((d) => d && onOpenEditor({ draftId: d.id, file: 'main.tex', line: 1 }))}
    />
  )
}

function DraftCheckBody({
  draftId,
  drafts,
  toast,
  setToast,
  closeToast,
  quickActions,
  onSelectDraft,
  onOpenEditor,
  onOpenHistory,
  onTargetChange,
  onNewDraft,
}: {
  draftId: string
  drafts: Draft[]
  toast: string | null
  setToast: (message: string | null) => void
  closeToast: () => void
  quickActions: (draft: Draft | null) => React.ReactNode
  onSelectDraft: (id: string) => void
  onOpenEditor: (target: EditorTarget) => void
  onOpenHistory: (draft: Draft) => void
  onTargetChange?: (open: boolean) => void
  onNewDraft: () => void
}) {
  const draft = useAuthorDraft(draftId)
  const parse = useAuthorParse(draftId)
  const latest = useAuthorCheck(draft.data?.lastCheckId ?? null)
  const running = useAuthorCheck(draft.data?.runningCheckId ?? null)
  const start = useStartCheck()
  const actions = useAuthorActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)

  const showTarget = (next: Target | null) => {
    setTarget(next)
    onTargetChange?.(next !== null)
  }
  useEffect(() => () => onTargetChange?.(false), [onTargetChange])

  const citations = latest.data?.citations ?? []
  const issues = citations.filter(isOpenIssue)
  // The selected row, else the first open issue — what the Evidence panel shows.
  const selected: Citation | undefined = citations.find((c) => c.id === selectedId) ?? issues[0]
  const checkId = latest.data?.id
  const isChecking = Boolean(draft.data?.runningCheckId) || start.isPending

  const recheck = () => {
    if (!draft.data || isChecking) return
    start.mutate(draft.data.id, {
      onError: (error) => setToast(`Could not start the check: ${errorMessage(error)}`),
    })
  }

  const override = async (citation: Citation, note: string) => {
    if (!draft.data || !checkId) return
    try {
      const check = await actions.overrideCitation(draft.data.id, checkId, citation, note)
      const next = (check.citations ?? []).filter(isOpenIssue)
      setSelectedId(next[0]?.id ?? null)
      setToast(note ? 'Kept your citation, note saved' : 'Kept your citation')
    } catch (error) {
      setToast(`Could not save the note: ${errorMessage(error)}`)
    }
  }

  const nextIssue = () => {
    if (issues.length === 0) return
    const index = issues.findIndex((c) => c.id === selected?.id)
    setSelectedId(issues[(index + 1) % issues.length].id)
  }

  if (draft.isPending) return <LoadingScreen label="Opening your draft…" />
  if (draft.isError) {
    const gone = errorMessage(draft.error).includes('no such draft')
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className={gone ? 'text-ink' : 'text-refutes'}>
          {gone ? 'This draft no longer exists.' : `Could not open this draft: ${errorMessage(draft.error)}`}
        </p>
        <div className="flex gap-2">
          {!gone && (
            <Button variant="ghost" onClick={() => void draft.refetch()}>
              Try again
            </Button>
          )}
          {drafts[0] && drafts[0].id !== draftId && (
            <Button variant="ghost" onClick={() => onSelectDraft(drafts[0].id)}>
              Open {drafts[0].title}
            </Button>
          )}
        </div>
      </Card>
    )
  }

  const current = draft.data
  const files = current.files.map((f) => f.name).join(' · ')

  return (
    <FadeIn className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Check a draft</h1>
          <p className="text-sm text-ink-muted">
            {files || 'no files yet'} · {current.status.checked} citation{current.status.checked === 1 ? '' : 's'} found ·{' '}
            {current.status.open} need{current.status.open === 1 ? 's' : ''} work
          </p>
        </div>
        <Button onClick={recheck} disabled={isChecking} aria-busy={isChecking} data-ask-target={askTarget({ kind: 'action', id: 'check' })}>
          {isChecking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
          {isChecking ? 'Checking…' : current.checks ? 'Re-check' : 'Check'}
        </Button>
      </header>

      {quickActions(current)}

      {running.data?.status === 'running' && <CheckProgress check={running.data} />}
      {running.data?.status === 'error' && (
        <p role="alert" className="text-sm text-refutes">
          The check failed: {running.data.message}
        </p>
      )}
      {latest.isError && (
        <p role="alert" className="text-sm text-refutes">
          Could not load the last check: {errorMessage(latest.error)}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ParsedDraftCard draftId={current.id} parse={parse.data} error={parse.error} onOpenEditor={onOpenEditor} />
        <CitationCheckCard draft={current} citations={citations} selectedId={selected?.id} onSelect={setSelectedId} checking={isChecking} />
      </div>

      <div className={target ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : undefined}>
        <div className="flex flex-col gap-4">
          <EvidencePanel
            citation={selected}
            issues={issues}
            onNext={nextIssue}
            onOverride={(c, note) => void override(c, note)}
            onReopen={(c) => {
              if (checkId) void actions.reopenCitation(current.id, checkId, c).catch((error) => setToast(`Could not reopen: ${errorMessage(error)}`))
            }}
            onAttachPdf={(c, file) =>
              void actions
                .attachPdf(current.id, c.key, file)
                .then(() => setToast(`${file.name} attached to \\cite{${c.key}}. Re-check to read it.`))
                .catch((error) => setToast(`Could not upload ${file.name}: ${errorMessage(error)}`))
            }
            onShow={showTarget}
          />

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <YourDraftsCard drafts={drafts} currentId={current.id} onSelect={onSelectDraft} onNew={onNewDraft} onHistory={onOpenHistory} />
          </div>
        </div>
        {target && (
          <div className="xl:sticky xl:top-6 xl:z-20 xl:self-start">
            <PageViewer key={target.paper} target={target} onClose={() => showTarget(null)} />
          </div>
        )}
      </div>

      <Toast message={toast} onClose={closeToast} />
    </FadeIn>
  )
}
