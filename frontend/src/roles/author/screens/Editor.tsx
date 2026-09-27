/**
 * Author LaTeX editor (Figma 565:3957): a full-bleed screen with its own top bar, the file
 * tabs + CodeMirror + status bar on the left and the live preview on the right. Reads the
 * same draft and check the Check a draft screen does, so the verdict marks in the gutter are
 * the citations it lists, and an edit here moves those citations' lines there.
 *
 * Saving. Typing is written to the gateway after a short pause (not per keystroke); every
 * write is one PUT of the whole file. The editor keeps two texts per file: what is on screen
 * (`texts`) and what the gateway last confirmed (`confirmed`). A file is dirty while they
 * differ — waiting for the pause, in flight, or refused — and that is what the tabs' dot,
 * the top bar's "saving… / saved / not saved · Retry" and the leave-page warning read.
 *
 *  - A reply is applied only if it answers the newest write of that file (a sequence number
 *    per file), so a slow, older reply can never put earlier text back on screen.
 *  - Content arriving through the draft query (a refetch, a replacement made elsewhere) is
 *    adopted only for files that are clean. A dirty file keeps the author's text, including
 *    after a refused write, until its own write lands.
 *  - A refused write stays dirty: the next keystroke or Retry sends it again.
 *  - Leaving the screen (Back, a tab, another draft) writes what is still pending first;
 *    closing the tab asks, through beforeunload, while anything is dirty.
 *
 * Ctrl/Cmd+S writes what is pending, then bumps the version — never when a write failed, so
 * a version always names text the gateway holds. Re-check does the same, then starts the run.
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
import type { Citation, Draft, ProjectFile } from '../../../types/draftCheck'
import { CodeEditor, type CiteCompletionSource, type CursorPosition, type LineMark } from '../components/editor/CodeEditor'
import { EditorTopBar, type EditorTab, type SaveStatus } from '../components/editor/EditorTopBar'
import { ExportMenu, type ExportKind } from '../components/editor/ExportMenu'
import { FileTabs } from '../components/editor/FileTabs'
import { PreviewPane } from '../components/editor/PreviewPane'
import { SplitPane } from '../components/editor/SplitPane'
import { StatusBar } from '../components/editor/StatusBar'
import { Toast } from '../components/Toast'
import type { EditorTarget } from '../editorTarget'

const COMMIT_DELAY_MS = 600

type Texts = Record<string, string>

export function Editor({
  target,
  onFileChange,
  onNavigate,
  onWriteFailed,
}: {
  target: EditorTarget
  /** The open file changed (for the URL). */
  onFileChange: (file: string) => void
  onNavigate: (tab: EditorTab | 'home') => void
  /** The write made on the way out of the editor was refused: the screen is gone by then, so
   * the app shows this. */
  onWriteFailed?: (message: string) => void
}) {
  const { draftId } = target
  const draft = useAuthorDraft(draftId)
  const check = useAuthorCheck(draft.data?.lastCheckId ?? null)
  const running = useAuthorCheck(draft.data?.runningCheckId ?? null)
  const saved = useSavedSources(draft.data?.projectId ?? undefined)
  const start = useStartCheck()
  const exportReport = useExportReport()
  const actions = useAuthorActions()
  const actionsRef = useRef(actions)
  const onWriteFailedRef = useRef(onWriteFailed)

  const files: ProjectFile[] = useMemo(() => draft.data?.files ?? [], [draft.data])
  const [activeName, setActiveName] = useState<string | null>(target.file ?? null)
  const active = files.find((f) => f.name === activeName) ?? files.find((f) => f.kind === 'tex') ?? files[0]

  // --- the two texts per file, and the writes between them --------------------------------
  const [texts, setTexts] = useState<Texts>({})
  const [confirmed, setConfirmed] = useState<Texts>({})
  const textsRef = useRef<Texts>({})
  const confirmedRef = useRef<Texts>({})
  // Mirrors for the callbacks and the unmount flush, kept current after every render (and
  // before the effects below, which run in order).
  useEffect(() => {
    textsRef.current = texts
    confirmedRef.current = confirmed
    actionsRef.current = actions
    onWriteFailedRef.current = onWriteFailed
  })
  const timers = useRef<Record<string, number>>({})
  const sequence = useRef<Record<string, number>>({})
  const inFlight = useRef<Record<string, Promise<boolean>>>({})
  const [writeError, setWriteError] = useState<string | null>(null)

  const isDirty = useCallback((name: string, t: Texts = textsRef.current, c: Texts = confirmedRef.current) => t[name] !== undefined && t[name] !== c[name], [])

  // What the gateway holds: adopted for a file the author has not changed (first load, a
  // replacement made on Check a draft, a refetch); a dirty file keeps the author's text.
  useEffect(() => {
    if (!draft.data) return
    const nextTexts = { ...textsRef.current }
    const nextConfirmed = { ...confirmedRef.current }
    let changed = false
    for (const file of draft.data.files) {
      const known = nextConfirmed[file.name]
      if (known === file.content) continue
      const clean = nextTexts[file.name] === undefined || nextTexts[file.name] === known
      nextConfirmed[file.name] = file.content
      if (clean) nextTexts[file.name] = file.content
      changed = true
    }
    if (changed) {
      setTexts(nextTexts)
      setConfirmed(nextConfirmed)
    }
  }, [draft.data])

  /** Writes one file's current text. Resolves true when the gateway took it. A reply to an
   * older write of the same file is dropped, so only the newest text is ever confirmed. */
  const commit = useCallback(
    (name: string): Promise<boolean> => {
      window.clearTimeout(timers.current[name])
      delete timers.current[name]
      const content = textsRef.current[name]
      if (content === undefined || content === confirmedRef.current[name]) return Promise.resolve(true)
      const seq = (sequence.current[name] ?? 0) + 1
      sequence.current[name] = seq
      const write = actionsRef.current
        .writeFile(draftId, name, content)
        .then((updated: Draft) => {
          if (sequence.current[name] !== seq) return true // superseded; the newer write answers
          setConfirmed((c) => ({ ...c, [name]: content }))
          actionsRef.current.acceptWrite(draftId, updated)
          setWriteError(null)
          return true
        })
        .catch((error: unknown) => {
          if (sequence.current[name] === seq) setWriteError(`Could not save ${name}: ${errorMessage(error)}`)
          return false
        })
        .finally(() => {
          if (inFlight.current[name] === write) delete inFlight.current[name]
        })
      inFlight.current[name] = write
      return write
    },
    [draftId],
  )

  const onChange = (name: string, content: string) => {
    setTexts((prev) => ({ ...prev, [name]: content }))
    setWriteError(null)
    window.clearTimeout(timers.current[name])
    timers.current[name] = window.setTimeout(() => void commit(name), COMMIT_DELAY_MS)
  }

  /** Writes every dirty file now; true when the gateway holds all of them. */
  const flush = useCallback(async (): Promise<boolean> => {
    const names = Object.keys(textsRef.current).filter((name) => isDirty(name))
    const results = await Promise.all(names.map((name) => commit(name)))
    return results.every(Boolean)
  }, [commit, isDirty])

  // Leaving the screen: send what is still waiting for the pause. The cache is updated when
  // the reply lands, so Check a draft shows the same text; a refusal is reported through the
  // app, since this screen is gone.
  useEffect(
    () => () => {
      for (const name of Object.keys(timers.current)) window.clearTimeout(timers.current[name])
      timers.current = {}
      for (const name of Object.keys(textsRef.current)) {
        if (!isDirty(name)) continue
        const content = textsRef.current[name]
        actionsRef.current
          .writeFile(draftId, name, content)
          .then((updated) => actionsRef.current.acceptWrite(draftId, updated))
          .catch((error: unknown) => onWriteFailedRef.current?.(`Your last edits to ${name} were not saved: ${errorMessage(error)}`))
      }
    },
    [draftId, isDirty],
  )

  const dirtyNames = useMemo(() => new Set(files.map((f) => f.name).filter((name) => isDirty(name, texts, confirmed))), [files, texts, confirmed, isDirty])
  const status: SaveStatus = writeError ? 'error' : dirtyNames.size > 0 ? 'saving' : 'saved'

  // Closing the tab with a dirty file: the browser asks first.
  useEffect(() => {
    if (dirtyNames.size === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyNames.size])

  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])

  const save = async () => {
    if (!(await flush())) {
      setToast('Not saved: the gateway refused the last edit. Retry, then save again.')
      return
    }
    try {
      await actions.saveDraft(draftId)
      setToast(`Saved as v${(draft.data?.version ?? 0) + 1}`)
    } catch (error) {
      setToast(`Could not save: ${errorMessage(error)}`)
    }
  }

  const recheck = async () => {
    if (!(await flush())) {
      setToast('Not checked: the gateway refused the last edit. Retry, then check again.')
      return
    }
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
    return { bibKeys, suggested }
  }, [entries, saved.data])

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
  const filesWithDirty = files.map((f) => ({ ...f, dirty: dirtyNames.has(f.name) }))

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <EditorTopBar
        title={draft.data.title}
        version={draft.data.version}
        status={status}
        onRetry={() => void flush()}
        onBack={() => onNavigate('home')}
        onNavigate={(tab) => onNavigate(tab)}
        onRecheck={() => void recheck()}
        rechecking={isChecking}
        exportSlot={<ExportMenu openIssues={draft.data.status.open} busy={exporting} onExport={exportAs} />}
      />
      {(start.isError || writeError || running.data?.status === 'error') && (
        <p role="alert" className="flex items-center gap-3 border-b border-refutes bg-refutes-soft px-4 py-1.5 text-xs text-refutes">
          <span className="min-w-0 flex-1">
            {writeError ?? (start.isError ? `Re-check failed: ${errorMessage(start.error)}` : `The check failed: ${running.data?.message}`)}
          </span>
          {writeError && (
            <button type="button" onClick={() => void flush()} className="shrink-0 rounded font-medium underline">
              Retry now
            </button>
          )}
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
            onKeepMine={(citation, note) => void keepMine(citation, note)}
          />
        }
      />
      <Toast message={toast} onClose={closeToast} />
    </div>
  )
}
