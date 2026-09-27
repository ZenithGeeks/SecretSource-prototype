/**
 * Author LaTeX editor (Figma 565:3957): a full-bleed screen with its own top bar, the file
 * tabs + CodeMirror + status bar on the left and the live preview on the right. Reads the
 * same draft and check the Check a draft screen does, so the verdict marks in the gutter are
 * the citations it lists, and an edit here moves those citations' lines there.
 *
 * Typing is written to the gateway after a short pause (not per keystroke). Ctrl/Cmd+S saves
 * (writes what is pending, then bumps the version). Re-check writes first, then starts the
 * run; the gateway saves a new version itself when the draft changed since the last one, so
 * the history's "vN" names the content that was checked. The preview's markers recolour as
 * the results stream in.
 */

import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Card } from '../../../components/ui'
import { errorMessage } from '../../../lib/author'
import { buildAnnotatedTex, buildProjectZip, buildUpdatedBib, slug } from '../../../lib/authorExport'
import { downloadBlob, downloadText } from '../../../lib/csv'
import { bibEntries, findCites, parseProject, sentenceStart } from '../../../lib/latexProject'
import { useAuthorActions, useAuthorCheck, useAuthorDraft, useExportReport, useSavedSources, useStartCheck } from '../../../lib/useAuthor'
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
import type { ReplacementRequest } from './DraftCheck'

const COMMIT_DELAY_MS = 600

export function Editor({
  target,
  onFileChange,
  onNavigate,
  onSearch,
  onFindReplacement,
}: {
  target: EditorTarget
  /** The open file changed (for the URL). */
  onFileChange: (file: string) => void
  onNavigate: (tab: EditorTab | 'home') => void
  /** The "search '…'" completion: open Find a source with this query. */
  onSearch: (query: string) => void
  /** The popover's "Find a replacement". */
  onFindReplacement: (request: ReplacementRequest) => void
}) {
  const { draftId } = target
  const draft = useAuthorDraft(draftId)
  const check = useAuthorCheck(draft.data?.lastCheckId ?? null)
  const running = useAuthorCheck(draft.data?.runningCheckId ?? null)
  const saved = useSavedSources(draft.data?.projectId ?? undefined)
  const start = useStartCheck()
  const exportReport = useExportReport()
  const actions = useAuthorActions()

  const files: ProjectFile[] = useMemo(() => draft.data?.files ?? [], [draft.data])
  const [activeName, setActiveName] = useState<string | null>(target.file ?? null)
  const active = files.find((f) => f.name === activeName) ?? files.find((f) => f.kind === 'tex') ?? files[0]

  // Local text per file, written to the gateway after a pause. `committed` remembers what we
  // last sent, so a change we did not make (a replacement) can be told apart from our own
  // text coming back through the query.
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const committed = useRef<Record<string, string>>({})
  const timers = useRef<Record<string, number>>({})
  const [pending, setPending] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)

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
    async (name: string, content: string) => {
      window.clearTimeout(timers.current[name])
      delete timers.current[name]
      if (committed.current[name] === content) return
      committed.current[name] = content
      try {
        await actions.putFile(draftId, name, content, true)
        setWriteError(null)
      } catch (error) {
        setWriteError(`Could not save ${name}: ${errorMessage(error)}`)
        delete committed.current[name]
      } finally {
        setPending(Object.keys(timers.current).length > 0)
      }
    },
    [actions, draftId],
  )

  const onChange = (name: string, content: string) => {
    setTexts((prev) => ({ ...prev, [name]: content }))
    setDirty((prev) => new Set(prev).add(name))
    setPending(true)
    window.clearTimeout(timers.current[name])
    timers.current[name] = window.setTimeout(() => void commit(name, content), COMMIT_DELAY_MS)
  }

  /** Writes every pending edit now. */
  const flush = useCallback(async () => {
    const names = Object.keys(timers.current)
    await Promise.all(names.map((name) => (texts[name] === undefined ? Promise.resolve() : commit(name, texts[name]))))
  }, [texts, commit])

  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), [])

  const save = async () => {
    await flush()
    try {
      await actions.saveDraft(draftId)
      setDirty(new Set())
      setToast(`Saved as v${(draft.data?.version ?? 0) + 1}`)
    } catch (error) {
      setToast(`Could not save: ${errorMessage(error)}`)
    }
  }

  const recheck = async () => {
    await flush()
    start.mutate(draftId, { onError: (error) => setToast(`Could not start the check: ${errorMessage(error)}`) })
  }

  const [cursor, setCursor] = useState<CursorPosition>({ line: target.line ?? 1, column: 1 })
  const [jump, setJump] = useState(target.line ? { line: target.line, nonce: 1 } : undefined)
  // A new target from outside (another "Fix in editor") opens its file and moves the cursor.
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

  const checkId = check.data?.id
  const keepMine = async (citation: Citation, note: string) => {
    if (!checkId) return
    try {
      await actions.overrideCitation(draftId, checkId, citation, note)
      setToast(note ? 'Kept your citation, note saved' : 'Kept your citation')
    } catch (error) {
      setToast(`Could not save the note: ${errorMessage(error)}`)
    }
  }

  // The Export menu. Text exports use what is on screen right now (pending edits included);
  // the PDF report comes from the gateway, from the latest check.
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const exportAs = async (kind: ExportKind): Promise<boolean | void> => {
    if (!draft.data || !active) return
    const current = { ...draft.data, files: draft.data.files.map((f) => ({ ...f, content: texts[f.name] ?? f.content })) }
    const name = slug(current.title)
    switch (kind) {
      case 'bib':
        downloadText(`${name}.bib`, buildUpdatedBib(current), 'application/x-bibtex')
        setToast(`Downloaded ${name}.bib`)
        return
      case 'tex': {
        const file = current.files.find((f) => f.name === active.name)!
        downloadText(file.name.split('/').pop()!, buildAnnotatedTex(file, check.data?.citations ?? []), 'application/x-tex')
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
          await flush()
          const pdf = await exportReport.mutateAsync(draftId)
          downloadBlob(`${name}-report.pdf`, pdf)
          setToast('Downloaded the verification report')
        } catch (error) {
          setToast(`Could not build the report: ${errorMessage(error)}`)
          return false
        } finally {
          setExporting(null)
        }
    }
  }

  const text = active ? (texts[active.name] ?? active.content) : ''
  const fileCitations = useMemo(() => (check.data?.citations ?? []).filter((c) => c.file === active?.name), [check.data, active?.name])
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
  // Warnings come from the project text as typed, so they follow the keystrokes.
  const liveFiles = useMemo(() => files.map((f) => ({ ...f, content: texts[f.name] ?? f.content })), [files, texts])
  const warningCount = useMemo(() => parseProject(liveFiles).warnings.filter((w) => w.file === active?.name).length, [liveFiles, active?.name])

  const entries = useMemo(() => bibEntries(liveFiles), [liveFiles])
  const completions: CiteCompletionSource = useMemo(() => {
    const seen = new Set<string>()
    const bibKeys = entries
      .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
      .map((e) => ({ key: e.key, detail: `${e.file} · ${(e.fields.title ?? '').split(':')[0].slice(0, 28)}` }))
    const suggested = (saved.data ?? []).filter((s) => !seen.has(s.key)).map((s) => ({ key: s.key, detail: 'saved · not in .bib' }))
    return { bibKeys, suggested, onSearch }
  }, [entries, saved.data, onSearch])

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
    const gone = draft.isError && errorMessage(draft.error).includes('no such draft')
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <Card className="flex flex-col items-start gap-3">
          <p className={gone ? 'text-ink' : 'text-refutes'}>
            {gone ? 'This draft no longer exists.' : draft.isError ? `Could not open this draft: ${errorMessage(draft.error)}` : 'This draft has no files.'}
          </p>
          <div className="flex gap-2">
            {draft.isError && !gone && (
              <Button variant="ghost" onClick={() => void draft.refetch()}>
                Try again
              </Button>
            )}
            <Button variant="ghost" onClick={() => onNavigate('home')}>
              Back to Check a draft
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const isChecking = Boolean(draft.data.runningCheckId) || start.isPending
  const savedState = !pending && dirty.size === 0
  const filesWithDirty = files.map((f) => ({ ...f, dirty: dirty.has(f.name) }))

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <EditorTopBar
        title={draft.data.title}
        version={draft.data.version}
        saved={savedState}
        onBack={() => onNavigate('home')}
        onNavigate={(tab) => onNavigate(tab)}
        onRecheck={() => void recheck()}
        rechecking={isChecking}
        exportSlot={<ExportMenu openIssues={draft.data.status.open} busy={exporting} onExport={exportAs} />}
      />
      {(start.isError || writeError || running.data?.status === 'error') && (
        <p role="alert" className="border-b border-refutes bg-refutes-soft px-4 py-1.5 text-xs text-refutes">
          {writeError ?? (start.isError ? `Re-check failed: ${errorMessage(start.error)}` : `The check failed: ${running.data?.message}`)}
        </p>
      )}
      <SplitPane
        leftLabel="Source"
        rightLabel="Preview"
        left={
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <FileTabs
              files={filesWithDirty}
              active={active.name}
              onSelect={selectFile}
              onAdd={(name) => {
                void actions
                  .putFile(draftId, name, '')
                  .then(() => selectFile(name))
                  .catch((error) => setToast(`Could not add ${name}: ${errorMessage(error)}`))
              }}
            />
            <CodeEditor
              key={`${draftId}:${active.name}`}
              ariaLabel={`${active.name} source`}
              value={text}
              marks={marks}
              completions={completions}
              onChange={(content) => onChange(active.name, content)}
              onCursor={setCursor}
              onSave={() => void save()}
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
            onFindReplacement={(citation) => checkId && onFindReplacement({ draftId, checkId, citationId: citation.id, claim: citation.claim })}
            onKeepMine={(citation, note) => void keepMine(citation, note)}
          />
        }
      />
      <Toast message={toast} onClose={closeToast} />
    </div>
  )
}
