/**
 * Author "Check a draft" (Figma 558:3647). Every card reads the one author store through
 * the useAuthor hooks, so a fix here is what the editor shows next, and the other way round.
 * The screen owns which citation is selected and the toast; the cards own their own filters.
 *
 * `draftId` comes from the URL (?draft=); the parent keys this component by it so selection
 * resets when the draft changes.
 */

import { Loader2, Search } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import { useAuthorActions, useAuthorCheck, useAuthorDrafts, useAuthorParse, useRecheck } from '../../../lib/useAuthor'
import type { Citation, SearchResult } from '../../../types/draftCheck'
import { CitationCheckCard } from '../components/CitationCheckCard'
import { EvidencePanel } from '../components/EvidencePanel'
import { FindSourcesCard } from '../components/FindSourcesCard'
import { ParsedDraftCard } from '../components/ParsedDraftCard'
import { QuickActions } from '../components/QuickActions'
import { Toast } from '../components/Toast'
import { YourDraftsCard } from '../components/YourDraftsCard'
import type { EditorTarget } from '../editorTarget'
import { FIND_SOURCES_INPUT_ID, replacementLabel } from '../labels'

export function DraftCheck({
  draftId,
  onSelectDraft,
  onOpenEditor,
  onOpenHistory,
}: {
  draftId: string
  onSelectDraft: (id: string) => void
  onOpenEditor: (target: EditorTarget) => void
  onOpenHistory: () => void
}) {
  const check = useAuthorCheck(draftId)
  const parse = useAuthorParse(draftId)
  const drafts = useAuthorDrafts()
  const recheck = useRecheck()
  const actions = useAuthorActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])

  const run = check.data
  const issues = run?.issues ?? []
  // The selected row, else the first open issue — what the Evidence panel shows.
  const selected: Citation | undefined = run?.citations.find((c) => c.id === selectedId) ?? issues[0]

  const replace = (citation: Citation, replacement: SearchResult) => {
    const next = actions.replaceCitation(citation.id, replacement)
    setSelectedId(next ?? null)
    setToast(`Citation replaced with ${replacementLabel(replacement)}`)
  }

  const override = (citation: Citation, note: string) => {
    const next = actions.overrideCitation(citation.id, note)
    setSelectedId(next ?? null)
    setToast(note ? 'Kept your citation, note saved' : 'Kept your citation')
  }

  const nextIssue = () => {
    if (issues.length === 0) return
    const index = issues.findIndex((c) => c.id === selected?.id)
    setSelectedId(issues[(index + 1) % issues.length].id)
  }

  const newDraft = (title?: string) => {
    const id = actions.createDraft(title)
    onSelectDraft(id)
    return id
  }

  if (check.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking your draft…
      </p>
    )
  }

  if (check.isError) {
    return (
      <Card className="flex flex-col items-start gap-3 border-refutes text-refutes">
        <p>Could not check this draft: {(check.error as Error).message}</p>
        <Button variant="ghost" onClick={() => check.refetch()}>
          Try again
        </Button>
      </Card>
    )
  }

  if (!run) {
    return (
      <Empty title="This draft no longer exists" hint="Pick another one from Your drafts, or upload a new file." />
    )
  }

  const { draft } = run
  const files = draft.files.map((f) => f.name).join(' · ')

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Check a draft</h1>
          <p className="text-sm text-ink-muted">
            {files || 'no files yet'} · {draft.status.checked} citation{draft.status.checked === 1 ? '' : 's'} found ·{' '}
            {draft.status.open} need{draft.status.open === 1 ? 's' : ''} work
          </p>
        </div>
        <Button onClick={() => recheck.mutate(draft.id)} disabled={recheck.isPending} aria-busy={recheck.isPending}>
          {recheck.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          {recheck.isPending ? 'Checking…' : 'Re-check'}
        </Button>
      </header>
      {recheck.isError && (
        <p role="alert" className="text-sm text-refutes">
          Re-check failed: {(recheck.error as Error).message}
        </p>
      )}

      <QuickActions
        onUpload={(file, text) => {
          const id = newDraft(file.name.replace(/\.(tex|zip)$/i, ''))
          if (file.name.toLowerCase().endsWith('.zip')) {
            setToast(`${file.name} added as a draft. Reading the files inside a .zip arrives with the export work.`)
          } else {
            actions.updateFile(id, 'main.tex', text)
            setToast(`${file.name} uploaded. Re-check when you are ready.`)
          }
        }}
        onPaste={() => onOpenEditor({ draftId: newDraft('Pasted draft'), file: 'main.tex', line: 1 })}
        onAddBibliography={(file, text) => {
          const name = file.name.endsWith('.bib') ? file.name : `${file.name}.bib`
          if (!draft.files.some((f) => f.name === name)) actions.addFile(draft.id, name)
          actions.updateFile(draft.id, name, text)
          setToast(`${name} added to ${draft.title}`)
        }}
        onFindSource={() => {
          const input = document.getElementById(FIND_SOURCES_INPUT_ID)
          input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          input?.focus({ preventScroll: true })
        }}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ParsedDraftCard draftId={draft.id} parse={parse.data} error={parse.error} onOpenEditor={onOpenEditor} />
        <CitationCheckCard draft={draft} citations={run.citations} selectedId={selected?.id} onSelect={setSelectedId} />
      </div>

      <EvidencePanel
        citation={selected}
        issues={issues}
        onNext={nextIssue}
        onReplace={replace}
        onOverride={override}
        onReopen={(c) => actions.reopenCitation(c.id)}
        onAttachPdf={(c, file) => {
          actions.attachSourcePdf(c.id, file.name)
          setToast(`${file.name} attached to \\cite{${c.key}}. Re-check to read it.`)
        }}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FindSourcesCard
          issues={issues}
          selectedIssue={selected && issues.some((c) => c.id === selected.id) ? selected : undefined}
          onInsert={replace}
          onCopied={(what) => setToast(`Copied ${what}`)}
        />
        <YourDraftsCard
          drafts={drafts.data ?? [draft]}
          currentId={draft.id}
          onSelect={onSelectDraft}
          onNew={() => onOpenEditor({ draftId: newDraft(), file: 'main.tex', line: 1 })}
          onHistory={onOpenHistory}
        />
      </div>

      <Toast message={toast} onClose={closeToast} />
    </>
  )
}
