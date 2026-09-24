/**
 * Author LaTeX editor (Figma 565:3957): a full-bleed screen with its own top bar, the file
 * tabs + CodeMirror + status bar on the left and the preview on the right. Reads the same
 * author store as Draft check, so the verdict marks in the gutter are the citations Draft
 * check lists, and an edit here moves those citations' lines there.
 *
 * Typing is committed to the store after a short pause (not per keystroke), which is also
 * when the parse warnings and citation lines catch up. Ctrl/Cmd+S saves (clears the dirty
 * dots, bumps the version).
 */

import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Card } from '../../../components/ui'
import { ReportUnavailable } from '../../../lib/author'
import { buildAnnotatedTex, buildProjectZip, buildUpdatedBib, slug } from '../../../lib/authorExport'
import { downloadBlob, downloadText } from '../../../lib/csv'
import { bibEntries, findCites, sentenceStart } from '../../../lib/latexProject'
import { useAuthorActions, useAuthorCheck, useAuthorDraft, useAuthorParse, useExportReport, useRecheck } from '../../../lib/useAuthor'
import { authorStore } from '../../../lib/authorStore'
import { isOpenIssue, summarize } from '../../../lib/verdict'
import type { Citation, ProjectFile } from '../../../types/draftCheck'
import { CodeEditor, type CiteCompletionSource, type CursorPosition, type LineMark } from '../components/editor/CodeEditor'
import { EditorTopBar, type EditorTab } from '../components/editor/EditorTopBar'
import { ExportMenu, type ExportKind } from '../components/editor/ExportMenu'
import { FileTabs } from '../components/editor/FileTabs'
import { PreviewPane } from '../components/editor/PreviewPane'
import { SplitPane } from '../components/editor/SplitPane'
import { StatusBar } from '../components/editor/StatusBar'
import { Toast } from '../components/Toast'
import type { EditorTarget } from '../editorTarget'
import { replacementLabel } from '../labels'

const COMMIT_DELAY_MS = 300

export function Editor({
  target,
  onFileChange,
  onNavigate,
  onSearch,
}: {
  target: EditorTarget
  /** The open file changed (for the URL). */
  onFileChange: (file: string) => void
  onNavigate: (tab: EditorTab | 'draft-check') => void
  /** The "search '…'" completion: open Find a source with this query. */
  onSearch: (query: string) => void
}) {
  const { draftId } = target
  const draft = useAuthorDraft(draftId)
  const check = useAuthorCheck(draftId)
  const parse = useAuthorParse(draftId)
  const recheck = useRecheck()
  const exportReport = useExportReport()
  const actions = useAuthorActions()

  const files: ProjectFile[] = useMemo(() => draft.data?.files ?? [], [draft.data])
  const [activeName, setActiveName] = useState<string | null>(target.file ?? null)
  const active = files.find((f) => f.name === activeName) ?? files.find((f) => f.kind === 'tex') ?? files[0]

  // Local text per file, committed to the store after a pause. `committed` remembers what
  // we last sent, so a store change we did not make (a replacement) can be told apart from
  // our own text coming back through the query.
  const [texts, setTexts] = useState<Record<string, string>>({})
  const committed = useRef<Record<string, string>>({})
  const timers = useRef<Record<string, number>>({})
  // True while an edit is waiting to be committed, so the breadcrumb can say "unsaved" at once.
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!draft.data) return
    setTexts((prev) => {
      const next = { ...prev }
      for (const file of draft.data!.files) {
        if (committed.current[file.name] !== file.content) {
          next[file.name] = file.content
          committed.current[file.name] = file.content
        }
      }
      return next
    })
  }, [draft.data])

  const commit = useCallback(
    (name: string, content: string) => {
      window.clearTimeout(timers.current[name])
      delete timers.current[name]
      committed.current[name] = content
      actions.updateFile(draftId, name, content)
      setPending(false)
    },
    [actions, draftId],
  )

  const onChange = (name: string, content: string) => {
    setTexts((prev) => ({ ...prev, [name]: content }))
    setPending(true)
    window.clearTimeout(timers.current[name])
    timers.current[name] = window.setTimeout(() => commit(name, content), COMMIT_DELAY_MS)
  }

  const flush = useCallback(() => {
    for (const name of Object.keys(timers.current)) {
      if (timers.current[name]) {
        window.clearTimeout(timers.current[name])
        delete timers.current[name]
        const content = texts[name]
        if (content !== undefined && committed.current[name] !== content) commit(name, content)
      }
    }
  }, [texts, commit])

  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), [])

  const save = () => {
    flush()
    actions.saveDraft(draftId)
  }

  const [cursor, setCursor] = useState<CursorPosition>({ line: target.line ?? 1, column: 1 })
  const [jump, setJump] = useState(target.line ? { line: target.line, nonce: 1 } : undefined)
  // A new target from outside (another "Fix in editor") opens its file and moves the cursor.
  // Derived during render, the way React suggests for state that follows a prop.
  const [seenTarget, setSeenTarget] = useState(target)
  if (seenTarget.file !== target.file || seenTarget.line !== target.line || seenTarget.draftId !== target.draftId) {
    setSeenTarget(target)
    if (target.file) setActiveName(target.file)
    if (target.line) setJump({ line: target.line, nonce: (jump?.nonce ?? 0) + 1 })
  }

  const selectFile = (name: string) => {
    setActiveName(name)
    onFileChange(name)
  }

  const [verdictColors, setVerdictColors] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])

  // The popover's actions: the same store calls Draft check makes, so both screens agree.
  const replaceFromPopover = (citation: Citation) => {
    if (!citation.suggestedReplacement) return
    actions.replaceCitation(citation.id, citation.suggestedReplacement)
    setToast(`Citation replaced with ${replacementLabel(citation.suggestedReplacement)}`)
  }
  const keepMine = (citation: Citation, note: string) => {
    actions.overrideCitation(citation.id, note)
    setToast(note ? 'Kept your citation, note saved' : 'Kept your citation')
  }

  // The Export menu. Text exports use what is on screen right now (pending edits included);
  // the PDF report goes through the service, which has no endpoint yet.
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const exportAs = async (kind: ExportKind): Promise<boolean | void> => {
    if (!draft.data || !active) return
    const current: typeof draft.data = {
      ...draft.data,
      files: draft.data.files.map((f) => ({ ...f, content: texts[f.name] ?? f.content })),
    }
    const name = slug(current.title)
    switch (kind) {
      case 'bib':
        downloadText(`${name}.bib`, buildUpdatedBib(current), 'application/x-bibtex')
        setToast(`Downloaded ${name}.bib`)
        return
      case 'tex': {
        const file = current.files.find((f) => f.name === active.name)!
        downloadText(file.name, buildAnnotatedTex(file, check.data?.citations ?? []), 'application/x-tex')
        setToast(`Downloaded ${file.name} with SecretSource comments`)
        return
      }
      case 'zip':
        downloadBlob(`${name}.zip`, buildProjectZip(current))
        setToast(`Downloaded ${name}.zip`)
        return
      case 'report':
        setExporting('report')
        try {
          const pdf = await exportReport.mutateAsync(draftId)
          downloadBlob(`${name}-report.pdf`, pdf)
          setToast('Downloaded the verification report')
        } catch (error) {
          setToast(error instanceof ReportUnavailable ? error.message : `Could not build the report: ${(error as Error).message}`)
        } finally {
          setExporting(null)
        }
    }
  }

  const text = active ? (texts[active.name] ?? active.content) : ''
  const fileCitations = useMemo(
    () => (check.data?.citations ?? []).filter((c) => c.file === active?.name),
    [check.data, active?.name],
  )
  const marks: LineMark[] = useMemo(
    () =>
      fileCitations.map((c) => ({
        line: c.line,
        key: c.key,
        verdict: c.verdict,
        shadeFrom: c.verdict === 'refutes' && isOpenIssue(c) ? sentenceStart(text, c.line) : undefined,
      })),
    [fileCitations, text],
  )
  const counts = useMemo(() => summarize(fileCitations).counts, [fileCitations])
  const citeCount = useMemo(() => (active ? findCites({ name: active.name, content: text }).length : 0), [active, text])
  const warningCount = (parse.data?.warnings ?? []).filter((w) => w.file === active?.name).length

  const entries = useMemo(() => bibEntries(files), [files])
  const completions: CiteCompletionSource = useMemo(() => {
    const seen = new Set<string>()
    const bibKeys = entries
      .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
      .map((e) => ({ key: e.key, detail: `${e.file} · ${(e.fields.title ?? '').split(':')[0].slice(0, 28)}` }))
    const suggested = draft.data ? authorStore.suggestedKeys(draftId).map((r) => ({ key: r.key, detail: 'suggested · not in .bib' })) : []
    return { bibKeys, suggested, onSearch }
  }, [entries, draft.data, draftId, onSearch])

  if (draft.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Opening your draft…
        </p>
      </div>
    )
  }

  if (draft.isError || !draft.data || !active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <Card className="flex flex-col items-start gap-3">
          <p className="text-refutes">
            {draft.isError ? `Could not open this draft: ${(draft.error as Error).message}` : 'This draft no longer exists.'}
          </p>
          <div className="flex gap-2">
            {draft.isError && (
              <Button variant="ghost" onClick={() => draft.refetch()}>
                Try again
              </Button>
            )}
            <Button variant="ghost" onClick={() => onNavigate('draft-check')}>
              Back to Check a draft
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const saved = !pending && !files.some((f) => f.dirty)

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <EditorTopBar
        title={draft.data.title}
        version={draft.data.version}
        saved={saved}
        onBack={() => onNavigate('draft-check')}
        onNavigate={(tab) => onNavigate(tab)}
        onRecheck={() => {
          flush()
          recheck.mutate(draftId)
        }}
        rechecking={recheck.isPending}
        exportSlot={<ExportMenu openIssues={draft.data.status.open} busy={exporting} onExport={exportAs} />}
      />
      {recheck.isError && (
        <p role="alert" className="border-b border-refutes bg-refutes-soft px-4 py-1.5 text-xs text-refutes">
          Re-check failed: {(recheck.error as Error).message}
        </p>
      )}
      <SplitPane
        leftLabel="Source"
        rightLabel="Preview"
        left={
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <FileTabs files={files} active={active.name} onSelect={selectFile} onAdd={(name) => {
              actions.addFile(draftId, name)
              selectFile(name)
            }} />
            <CodeEditor
              key={`${draftId}:${active.name}`}
              ariaLabel={`${active.name} source`}
              value={text}
              marks={marks}
              completions={completions}
              onChange={(content) => onChange(active.name, content)}
              onCursor={setCursor}
              onSave={save}
              jumpTo={jump}
            />
            <StatusBar counts={counts} cursor={cursor} citeCount={citeCount} warningCount={warningCount} />
          </div>
        }
        right={
          <PreviewPane
            content={text}
            citations={fileCitations}
            bibEntries={entries}
            verdictColors={verdictColors}
            onToggleVerdictColors={() => setVerdictColors((v) => !v)}
            onReplace={replaceFromPopover}
            onKeepMine={keepMine}
          />
        }
      />
      <Toast message={toast} onClose={closeToast} />
    </div>
  )
}
