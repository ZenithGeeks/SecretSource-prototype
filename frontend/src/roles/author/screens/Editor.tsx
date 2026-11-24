/**
 * Author LaTeX editor (Figma 565:3957): a full-bleed screen with its own top bar, the file
 * tabs + CodeMirror + status bar on the left and the live preview on the right. Reads the
 * same draft and check Home does, so the verdict marks in the gutter are
 * the citations it lists, and an edit here moves those citations' lines there.
 *
 * Saving. Typing is written to the gateway once it pauses for AUTOSAVE_DELAY_MS (not per
 * keystroke); every write is one PUT of the whole file. The editor keeps two texts per file:
 * what is on screen (`texts`) and what the gateway last confirmed (`confirmed`). A file is
 * dirty while they differ — waiting for the pause, in flight, or refused — and that is what
 * the tabs' dot, the top bar's "Unsaved changes / Saving… / Saved / Save failed — retry" and
 * the leave-page warning read.
 *
 *  - One write of a file is in flight at a time: the next waits for its answer, so the
 *    gateway can never apply two writes of the same file in the wrong order. A reply is
 *    applied only if it answers the newest write of that file (a sequence number per file),
 *    so a superseded reply never puts earlier text back on screen.
 *  - Every write carries the draft's `updated` this editor last saw (from the draft it read,
 *    then from each write's answer). The gateway refuses a write whose value is stale (409):
 *    another tab saved in between. The project's shared .bib is written to the project, so its
 *    tab sends that file's own `updated` instead: another draft may have written it. The file
 *    stays dirty with the author's text, the draft is
 *    refetched, and the author is asked: Keep my version overwrites the newer copy, Use the
 *    saved copy puts it on screen. Until they choose, nothing writes that file.
 *  - Text the gateway has not taken (a refused write, a tab closed with edits pending) is kept
 *    in localStorage by draft id; reopening the draft offers it back where it differs from
 *    what the gateway holds, and it is dropped once everything is saved.
 *  - A rename (click the title) does not move `updated`, so it never makes a write a conflict.
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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button, Card } from '../../../components/ui'
import type { DraftReader } from '../../../lib/agentTools'
import { errorMessage } from '../../../lib/author'
import { buildAnnotatedTex, buildProjectZip, buildUpdatedBib, slug } from '../../../lib/authorExport'
import { shortMessage } from '../../../lib/citations'
import { downloadBlob, downloadText } from '../../../lib/csv'
import { AUTOSAVE_DELAY_MS, DEFAULT_TITLE, dropBackup, forgetBackup, readBackup, texTitle, writeBackup, type Backup } from '../../../lib/draftSave'
import { useDebounced } from '../../../lib/useDebounced'
import { type BibProblem, bibEntries, bibKeys, bibProblems, findCites, parseProject, sentenceStart, WARNING_TITLE, withContent } from '../../../lib/latexProject'
import { useAuthorActions, useAuthorCheck, useAuthorDraft, useExportReport, useProjectLint, useProjectName, useSavedSources, useStartCheck } from '../../../lib/useAuthor'
import { isOpenIssue, summarize, VERDICTS } from '../../../lib/verdict'
import type { Citation, Draft, ProjectFile } from '../../../types/draftCheck'
import { CodeEditor, type CiteCompletionSource, type CursorPosition, type LineMark, type ProblemMark } from '../components/editor/CodeEditor'
import { EditorTopBar, type SaveStatus } from '../components/editor/EditorTopBar'
import { ExportMenu, type ExportKind } from '../components/editor/ExportMenu'
import { FileTabs } from '../components/editor/FileTabs'
import { PreviewPane } from '../components/editor/PreviewPane'
import { SplitPane } from '../../../components/SplitPane'
import { StatusBar } from '../components/editor/StatusBar'
import type { EditorTarget } from '../editorTarget'

type Texts = Record<string, string>

/** How long typing must pause before a 	itle is offered as the draft's name. */
const TITLE_OFFER_DELAY_MS = 1_000


/** The gateway refused the write because the draft changed since this editor last saw it. */
const isConflict = (error: unknown) => error instanceof Error && error.message.startsWith('409: ')

export function Editor({
  target,
  onFileChange,
  onNavigate,
  onWriteFailed,
  onAgentApi,
  askSlot,
  back,
  onOpenProject,
  onAskToFix,
  autosaveMs = AUTOSAVE_DELAY_MS,
}: {
  target: EditorTarget
  /** How long typing must pause before a write; AUTOSAVE_DELAY_MS unless a test shortens it. */
  autosaveMs?: number
  /** The open file changed (for the URL). */
  onFileChange: (file: string) => void
  /** To Home: the breadcrumb's Home, and Back when `back` is not given. */
  onNavigate: (screen: 'home') => void
  /** Back to the screen the editor was opened from (the app knows it), named by `label`. */
  back?: { label: string; onClick: () => void }
  /** Opens the draft's project page, from the breadcrumb. */
  onOpenProject?: (projectId: string) => void
  /** Opens Ask's Do it mode with this request typed in, from an issue's "Ask AI how to fix". */
  onAskToFix?: (request: string) => void
  /** The write made on the way out of the editor was refused: the screen is gone by then, so
   * the app shows this. */
  onWriteFailed?: (message: string) => void
  /** Hands Ask's read_draft what is on screen while this editor is open; null when it closes. */
  onAgentApi?: (api: DraftReader | null) => void
  /** The Ask button, in the top bar. */
  askSlot?: ReactNode
}) {
  const { draftId } = target
  const draft = useAuthorDraft(draftId)
  const check = useAuthorCheck(draft.data?.lastCheckId ?? null)
  const running = useAuthorCheck(draft.data?.runningCheckId ?? null)
  const saved = useSavedSources(draft.data?.projectId ?? undefined)
  const projectName = useProjectName(draft.data?.projectId)
  const start = useStartCheck()
  const exportReport = useExportReport()
  const actions = useAuthorActions()
  const actionsRef = useRef(actions)
  const onWriteFailedRef = useRef(onWriteFailed)
  const refetchDraftRef = useRef(draft.refetch)
  /** The draft's `updated` as this editor last saw it, sent with every write (see the header). */
  const lastUpdated = useRef<string | undefined>(undefined)
  /** The same for the project's shared .bib, by name: it is the project's file, with its own. */
  const sharedTokens = useRef<Record<string, string | undefined>>({})
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
    refetchDraftRef.current = draft.refetch
  })
  /** Takes both kinds of token from a draft the gateway answered with. A shared .bib with unsaved
   * edits here that another draft changed underneath keeps the version those edits were based
   * on, so their write is refused (409) and the author chooses: any answer carries the .bib's
   * newest version, even one to a write of another file. `taken` names files whose newest
   * version this editor does take: the file it just wrote, or ones the author chose about. */
  const adoptTokens = useCallback((data: Draft, taken: readonly string[] = []) => {
    lastUpdated.current = data.updated
    const before = sharedTokens.current
    sharedTokens.current = Object.fromEntries(
      data.files
        .filter((f) => f.shared)
        .map((f) => {
          const text = textsRef.current[f.name]
          const based = confirmedRef.current[f.name]
          const keep = f.name in before && !taken.includes(f.name) && text !== undefined && text !== based && f.content !== based
          return [f.name, keep ? before[f.name] : (f.updated ?? undefined)]
        }),
    )
  }, [])
  const tokenFor = useCallback((name: string) => (name in sharedTokens.current ? sharedTokens.current[name] : lastUpdated.current), [])

  const timers = useRef<Record<string, number>>({})
  const sequence = useRef<Record<string, number>>({})
  const inFlight = useRef<Record<string, Promise<boolean>>>({})
  /** The files with a write in flight, as state: `inFlight` for what the screen shows. */
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set())
  const [writeError, setWriteError] = useState<string | null>(null)

  const isDirty = useCallback((name: string, t: Texts = textsRef.current, c: Texts = confirmedRef.current) => t[name] !== undefined && t[name] !== c[name], [])
  /** True while the gateway may not hold this file's text: it differs from the last confirmed
   * text, or a write is still in flight. The second matters when the author types, the write
   * goes out, and they undo before it answers: the text matches the confirmed one again, yet
   * the gateway is about to hold what was typed. */
  const isUnsettled = useCallback((name: string) => textsRef.current[name] !== undefined && (isDirty(name) || inFlight.current[name] !== undefined), [isDirty])
  /** Keeps every file the gateway may not hold on this device (see Backup). */
  const backupNow = useCallback(() => {
    const kept: Texts = {}
    for (const name of Object.keys(textsRef.current)) if (isUnsettled(name)) kept[name] = textsRef.current[name]
    writeBackup(draftId, kept)
  }, [draftId, isUnsettled])
  /** The files whose writes the gateway refused because someone else changed them since this
   * editor last saved: the author chooses between their text and the saved copy (never
   * overwritten silently), and until then nothing writes them. */
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set())
  const conflictsRef = useRef<ReadonlySet<string>>(conflicts)
  useEffect(() => {
    conflictsRef.current = conflicts
  })

  // What the gateway holds: adopted for a file the author has not changed (first load, a
  // replacement made on Home, a refetch); a dirty file keeps the author's text.
  useEffect(() => {
    if (!draft.data) return
    const sharedBefore = new Set(Object.keys(sharedTokens.current))
    adoptTokens(draft.data)
    const nextTexts = { ...textsRef.current }
    const nextConfirmed = { ...confirmedRef.current }
    let changed = false
    for (const file of draft.data.files) {
      const known = nextConfirmed[file.name]
      if (known === file.content) continue
      const clean = nextTexts[file.name] === undefined || nextTexts[file.name] === known
      if (!clean && file.shared && sharedBefore.has(file.name)) {
        // Another draft wrote the project's .bib under this tab's unsaved edits: keep what they
        // were based on (adoptTokens keeps its version too), so their write is refused and the
        // author chooses, never overwrites.
        continue
      }
      nextConfirmed[file.name] = file.content
      if (clean) nextTexts[file.name] = file.content
      changed = true
    }
    if (changed) {
      setTexts(nextTexts)
      setConfirmed(nextConfirmed)
    }
  }, [draft.data, adoptTokens])

  /** Writes one file's current text. Resolves true when the gateway took it. The write goes
   * out once the file's previous write has answered (one in flight per file), so the gateway
   * applies them in order; by then a newer commit may have superseded this one, which then
   * sends nothing. A reply to a superseded write is dropped, so only the newest text is ever
   * confirmed. Text equal to the confirmed one is still written when a write is in flight:
   * that write carries other text, and this one puts the gateway back in step. */
  const commit = useCallback(
    (name: string): Promise<boolean> => {
      window.clearTimeout(timers.current[name])
      delete timers.current[name]
      const content = textsRef.current[name]
      const pending = inFlight.current[name]
      if (content === undefined || (content === confirmedRef.current[name] && !pending)) return Promise.resolve(true)
      const seq = (sequence.current[name] ?? 0) + 1
      sequence.current[name] = seq
      const previous = pending ?? Promise.resolve(true)
      const write: Promise<boolean> = previous
        .then(() => {
          if (sequence.current[name] !== seq) return true // superseded before it went out; the newer write answers
          const accept = (updated: Draft) => {
            const shared = name in sharedTokens.current
            adoptTokens(updated, [name])
            if (sequence.current[name] !== seq) return true // superseded; the newer write answers
            setConfirmed((c) => ({ ...c, [name]: content }))
            actionsRef.current.acceptWrite(draftId, updated, shared)
            setWriteError(null)
            return true
          }
          return actionsRef.current
            .writeFile(draftId, name, content, tokenFor(name))
            .then(accept)
            .catch(async (error: unknown) => {
              if (isConflict(error)) {
                // `updated` is the draft's, not this file's: it also moves on this editor's own
                // Save or check, or when another tab changes another file. Read the draft
                // again; if this file is still what this editor last confirmed, nobody changed
                // it, so write it again against the new value.
                const { data } = await refetchDraftRef.current()
                const held = data?.files.find((f) => f.name === name)?.content
                if (data && held === confirmedRef.current[name]) {
                  adoptTokens(data)
                  try {
                    return accept(await actionsRef.current.writeFile(draftId, name, content, tokenFor(name)))
                  } catch (again) {
                    error = again
                  }
                }
              }
              backupNow()
              if (isConflict(error)) {
                // Someone else changed this file: it stays dirty with the author's text until
                // they choose (see `conflicts`).
                if (sequence.current[name] === seq) {
                  setConflicts((names) => new Set([...names, name]))
                  setWriteError(`${name} was changed elsewhere (${name in sharedTokens.current ? 'another draft or tab?' : 'another tab?'}) since this editor last saved it.`)
                }
              } else if (sequence.current[name] === seq) {
                setWriteError(`Could not save ${name}: ${errorMessage(error)}`)
              }
              return false
            })
        })
        .finally(() => {
          if (inFlight.current[name] !== write) return
          delete inFlight.current[name]
          setWriting((names) => new Set([...names].filter((n) => n !== name)))
        })
      inFlight.current[name] = write
      setWriting((names) => (names.has(name) ? names : new Set([...names, name])))
      return write
    },
    [draftId, backupNow, adoptTokens, tokenFor],
  )

  const onChange = (name: string, content: string) => {
    setTexts((prev) => ({ ...prev, [name]: content }))
    window.clearTimeout(timers.current[name])
    // A file in conflict is not written again until the author chooses (see `conflicts`).
    if (conflicts.has(name)) return
    if (conflicts.size === 0) setWriteError(null)
    timers.current[name] = window.setTimeout(() => void commit(name), autosaveMs)
  }

  /** Writes every file the gateway may not hold now; true when it holds all of them. A file in
   * conflict is left for the author to settle, so this is false while there is one. */
  const flush = useCallback(async (): Promise<boolean> => {
    const names = Object.keys(textsRef.current).filter((name) => isUnsettled(name) && !conflictsRef.current.has(name))
    const results = await Promise.all(names.map((name) => commit(name)))
    return results.every(Boolean) && conflictsRef.current.size === 0
  }, [commit, isUnsettled])

  // Leaving the screen: send what is still waiting for the pause. The cache is updated when
  // the reply lands, so Home shows the same text; a refusal is reported through the
  // app, since this screen is gone.
  useEffect(
    () => () => {
      for (const name of Object.keys(timers.current)) window.clearTimeout(timers.current[name])
      timers.current = {}
      // Kept on this device first, in case these last writes are refused too.
      backupNow()
      for (const name of Object.keys(textsRef.current)) {
        // A file in conflict is not overwritten on the way out; its text stays in the backup.
        if (!isUnsettled(name) || conflictsRef.current.has(name)) continue
        const content = textsRef.current[name]
        // After the file's in-flight write, if any, for the same reason commit() waits.
        const previous = inFlight.current[name] ?? Promise.resolve(true)
        void previous.then(() =>
          actionsRef.current
            .writeFile(draftId, name, content, tokenFor(name))
            .then((updated) => {
              actionsRef.current.acceptWrite(draftId, updated, name in sharedTokens.current)
              // Written after all: what was kept for it would only be offered back stale.
              forgetBackup(draftId, name, content)
            })
            .catch((error: unknown) => onWriteFailedRef.current?.(`Your last edits to ${name} were not saved: ${errorMessage(error)}`)),
        )
      }
    },
    [draftId, isUnsettled, backupNow, tokenFor],
  )

  const dirtyNames = useMemo(
    () => new Set(files.map((f) => f.name).filter((name) => isDirty(name, texts, confirmed) || writing.has(name))),
    [files, texts, confirmed, writing, isDirty],
  )
  const status: SaveStatus = writeError ? 'error' : writing.size > 0 ? 'saving' : dirtyNames.size > 0 ? 'unsaved' : 'saved'

  // Closing the tab with a dirty file: the text is kept on this device, and the browser asks.
  useEffect(() => {
    if (dirtyNames.size === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      backupNow()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyNames.size, backupNow])

  // Text kept on this device by an earlier visit (see Backup), offered back for the files where
  // it differs from what the gateway holds; dropped when it no longer differs anywhere.
  const [recovery, setRecovery] = useState<Backup | null>(() => readBackup(draftId))
  const recoverable = useMemo(
    () => (recovery && draft.data ? Object.entries(recovery.files).filter(([name, content]) => draft.data!.files.some((f) => f.name === name && f.content !== content)) : []),
    [recovery, draft.data],
  )
  const offering = recovery !== null && recoverable.length > 0
  // Everything written and nothing offered back: nothing to keep on this device any more.
  useEffect(() => {
    if (draft.data && !offering && status === 'saved') dropBackup(draftId)
  }, [draft.data, offering, status, draftId])


  const [savingVersion, setSavingVersion] = useState(false)
  const save = async () => {
    if (savingVersion) return
    setSavingVersion(true)
    try {
      if (!(await flush())) {
        toast.error(conflictsRef.current.size ? 'Not saved: choose which version of the file to keep first.' : 'Not saved: the gateway refused the last edit. Retry, then save again.')
        return
      }
      const saved = await actions.saveDraft(draftId)
      // A version moves the draft's `updated`; the next write carries the new value.
      lastUpdated.current = saved.updated
      toast.success(`Saved as v${saved.version}`)
    } catch (error) {
      toast.error(`Could not save: ${errorMessage(error)}`)
    } finally {
      setSavingVersion(false)
    }
  }
  // Ctrl/Cmd+S anywhere on the screen, not only in the source (where CodeMirror takes it first
  // and marks the event handled), so the browser's own "save page" never opens here.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** The author's choice for the files in conflict: their text over the newer saved copies, or
   * the saved copies over their text. Either way from the draft as the gateway holds it now. */
  const settleConflicts = async (keep: 'mine' | 'saved') => {
    const names = [...conflictsRef.current]
    if (names.length === 0) return
    const { data } = await refetchDraftRef.current()
    if (data) adoptTokens(data, names)
    setConflicts(new Set())
    conflictsRef.current = new Set()
    setWriteError(null)
    if (keep === 'mine') {
      await Promise.all(names.map((name) => commit(name)))
      return
    }
    for (const name of names) {
      const saved = data?.files.find((f) => f.name === name)?.content
      if (saved === undefined) continue
      window.clearTimeout(timers.current[name])
      setTexts((t) => ({ ...t, [name]: saved }))
      setConfirmed((c) => ({ ...c, [name]: saved }))
    }
  }
  const keepMineButton = useRef<HTMLButtonElement>(null)

  /** A draft whose own copy hides its project's .bib (`bibFork`, #733): the author either cites
   * the project's again, which drops the copy and any edits to it, or keeps the copy. */
  const [settlingFork, setSettlingFork] = useState(false)
  const settleFork = async (keep: 'project' | 'draft') => {
    const name = draft.data?.bibFork
    if (!name) return
    setSettlingFork(true)
    try {
      if (keep === 'project') {
        // Nothing more goes to the copy, and a write already out lands on it before it is
        // dropped: once it is gone, a write of this name would be the project's .bib.
        window.clearTimeout(timers.current[name])
        delete timers.current[name]
        sequence.current[name] = (sequence.current[name] ?? 0) + 1
        await inFlight.current[name]
      }
      const settled = await actions.settleBibFork(draftId, keep)
      if (keep === 'project') {
        const projectBib = settled.files.find((f) => f.name === name)?.content ?? ''
        setTexts((t) => ({ ...t, [name]: projectBib }))
        setConfirmed((c) => ({ ...c, [name]: projectBib }))
        // The copy's text is gone for good: never offered back, where Restore would write it
        // over the project's .bib, and no longer a conflict to settle.
        const kept = readBackup(draftId)?.files[name]
        if (kept !== undefined) forgetBackup(draftId, name, kept)
        setRecovery((r) => (r && name in r.files ? { ...r, files: Object.fromEntries(Object.entries(r.files).filter(([n]) => n !== name)) } : r))
        setConflicts((names) => new Set([...names].filter((n) => n !== name)))
      }
    } catch (error) {
      toast.error(`Not changed: ${errorMessage(error)}`)
      // The copy is still the draft's: what was typed into it and held back goes to it now.
      if (keep === 'project') void commit(name)
    } finally {
      setSettlingFork(false)
    }
  }

  const rename = async (title: string): Promise<string | null> => {
    try {
      await actions.updateDraft(draftId, { title })
      return null
    } catch (error) {
      return `Not renamed: ${errorMessage(error)}`
    }
  }

  // A new draft still called "Untitled draft N" whose LaTeX has a \title: offer that as its name.
  // Read only for such a draft, and once typing pauses, so a half-typed \title is not offered.
  const [titleOfferDismissed, setTitleOfferDismissed] = useState(false)
  const wantsTitle = !titleOfferDismissed && DEFAULT_TITLE.test(draft.data?.title ?? '')
  const settledTexts = useDebounced(texts, TITLE_OFFER_DELAY_MS)
  const suggestedTitle = useMemo(() => {
    if (!wantsTitle) return ''
    const tex = files.filter((f) => f.kind === 'tex')
    const main = tex.find((f) => /\\begin\{document\}/.test(settledTexts[f.name] ?? f.content)) ?? tex[0]
    return main ? texTitle(settledTexts[main.name] ?? main.content) : ''
  }, [wantsTitle, files, settledTexts])
  const offeredTitle = wantsTitle && suggestedTitle ? suggestedTitle : null

  const recheck = async () => {
    if (!(await flush())) {
      toast.error('Not checked: the gateway refused the last edit. Retry, then check again.')
      return
    }
    start.mutate(draftId, { onError: (error) => toast.error(`Could not start the check: ${errorMessage(error)}`) })
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
      toast.success(note ? 'Kept your citation, note saved' : 'Kept your citation')
    } catch (error) {
      toast.error(`Could not save the note: ${errorMessage(error)}`)
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
        toast.success(`Downloaded ${name}.bib`)
        return
      case 'tex': {
        const file = current.files.find((f) => f.name === active.name)!
        downloadText(file.name.split('/').pop()!, buildAnnotatedTex(file, check.data?.citations ?? []), 'application/x-tex')
        toast.success(`Downloaded ${file.name} with SecretSource comments`)
        return
      }
      case 'zip':
        downloadBlob(`${name}.zip`, buildProjectZip(current))
        toast.success(`Downloaded ${name}.zip`)
        return
      case 'report':
        setExporting('report')
        try {
          await flush()
          const pdf = await exportReport.mutateAsync(draftId)
          downloadBlob(`${name}-report.pdf`, pdf)
          toast.success('Downloaded the verification report')
        } catch (error) {
          toast.error(`Could not build the report: ${errorMessage(error)}`)
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
  // Open issues per file, for the dots on the file tabs (the same rule as the popover's pager).
  const issuesByFile = useMemo(() => {
    const issues: Record<string, number> = {}
    for (const c of check.data?.citations ?? []) if (isOpenIssue(c)) issues[c.file] = (issues[c.file] ?? 0) + 1
    return issues
  }, [check.data])
  const citeCount = useMemo(() => (active ? findCites({ name: active.name, content: text }).length : 0), [active, text])
  // Warnings come from the project text as typed, so they follow the keystrokes. A file that
  // was not typed in stays the same object, so only the edited one is scanned again.
  const liveFiles = useMemo(() => files.map((f) => withContent(f, texts[f.name] ?? f.content)), [files, texts])
  // .bib problems: parseProject's .bib warnings, one per entry, marked in the .bib editor and
  // dotted on its tab. The project's shared .bib is cited by every draft of the project, so
  // whether its entries are cited comes from the project's lint, not from this draft alone.
  const sharesBib = files.some((f) => f.shared)
  const lint = useProjectLint(sharesBib ? (draft.data?.projectId ?? null) : null)
  const problems = useMemo(() => {
    const shared = new Set(liveFiles.filter((f) => f.shared).map((f) => f.name))
    const own = bibProblems(liveFiles).filter((p) => !(p.type === 'unused-entry' && shared.has(p.file)))
    const projectWide: BibProblem[] = (lint.data?.warnings ?? [])
      .filter((w) => w.draftId === null && w.type === 'unused-entry' && shared.has(w.file))
      // The lint folds every never-cited entry into one warning on the first of them.
      .map((w) => ({ type: 'unused-entry', key: w.detail.split(' ')[0], file: w.file, line: w.line, message: `${w.detail} in any draft of this project` }))
    return [...own, ...projectWide]
  }, [liveFiles, lint.data])
  const problemsByFile = useMemo(() => {
    const count: Record<string, number> = {}
    for (const p of problems) count[p.file] = (count[p.file] ?? 0) + 1
    return count
  }, [problems])
  const activeProblems: ProblemMark[] = useMemo(
    () => problems.filter((p) => p.file === active?.name).map((p) => ({ line: p.line, key: p.key, title: WARNING_TITLE[p.type], message: p.message })),
    [problems, active?.name],
  )
  const warningCount = useMemo(
    () => (active?.kind === 'bib' ? activeProblems.length : parseProject(liveFiles).warnings.filter((w) => w.file === active?.name).length),
    [liveFiles, active?.name, active?.kind, activeProblems],
  )

  const entries = useMemo(() => bibEntries(liveFiles), [liveFiles])
  const completions: CiteCompletionSource = useMemo(() => {
    const seen = new Set<string>()
    const bibKeys = entries
      .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
      .map((e) => ({ key: e.key, detail: `${e.file} · ${(e.fields.title ?? '').split(':')[0].slice(0, 28)}` }))
    const suggested = (saved.data ?? []).filter((s) => !seen.has(s.key)).map((s) => ({ key: s.key, detail: 'saved · not in .bib' }))
    return { bibKeys, suggested }
  }, [entries, saved.data])

  // What Ask's read_draft reads: the project as on screen, kept current after every render. One
  // reader for the editor's life, so the app holds a single handle while this screen is open.
  const shown = { id: draftId, title: draft.data?.title ?? '' }
  const onScreen = useRef({ liveFiles, dirtyNames, active: active?.name, shown })
  useEffect(() => {
    onScreen.current = { liveFiles, dirtyNames, active: active?.name, shown }
  })
  useEffect(() => {
    if (!onAgentApi) return
    const reader: DraftReader = {
      draft: () => onScreen.current.shown,
      get active() {
        return onScreen.current.active
      },
      files: () => onScreen.current.liveFiles.map((f) => ({ name: f.name, kind: f.kind, dirty: onScreen.current.dirtyNames.has(f.name) })),
      read: (file) => onScreen.current.liveFiles.find((f) => f.name === file)?.content,
      bibKeys: () => bibKeys(onScreen.current.liveFiles),
    }
    onAgentApi(reader)
    return () => onAgentApi(null)
  }, [onAgentApi])

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
              Back to Home
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const isChecking = Boolean(draft.data.runningCheckId) || start.isPending
  const filesWithDirty = files.map((f) => ({ ...f, dirty: dirtyNames.has(f.name), issues: issuesByFile[f.name], problems: problemsByFile[f.name] }))
  const projectId = draft.data.projectId
  // Typed into Do it, not sent: the person reads it first. The why is cut short to keep it a request.
  const askToFix =
    onAskToFix &&
    ((c: Citation) => {
      const why = c.explanation && c.explanation.length > 300 ? `${c.explanation.slice(0, 299)}…` : c.explanation
      onAskToFix(`How do I fix \\cite{${c.key}} in ${c.file}, line ${c.line}: ${VERDICTS[c.verdict].badge.toLowerCase()}${why ? ` — ${why}` : '.'}`)
    })

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <EditorTopBar
        title={draft.data.title}
        status={status}
        onRetry={() => (conflicts.size ? keepMineButton.current?.focus() : void flush())}
        onRename={rename}
        onSave={() => void save()}
        saving={savingVersion}
        back={back ?? { label: 'Home', onClick: () => onNavigate('home') }}
        onHome={() => onNavigate('home')}
        project={projectId && projectName && onOpenProject ? { name: projectName, onOpen: () => onOpenProject(projectId) } : undefined}
        onRecheck={() => void recheck()}
        rechecking={isChecking}
        lastCheckedAt={draft.data.lastCheckedAt}
        exportSlot={<ExportMenu openIssues={draft.data.status.open} busy={exporting} onExport={exportAs} />}
        askSlot={askSlot}
      />
      {conflicts.size > 0 ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-refutes bg-refutes-soft px-4 py-1.5 text-xs text-refutes">
          <span className="min-w-0 flex-1">
            {[...conflicts].join(' and ')} {conflicts.size === 1 ? 'was' : 'were'} changed elsewhere (
            {files.some((f) => f.shared && conflicts.has(f.name)) ? 'another draft or tab?' : 'another tab?'}) since this editor last saved{' '}
            {conflicts.size === 1 ? 'it. Which version do you want to keep?' : 'them. Which versions do you want to keep?'}
          </span>
          <button ref={keepMineButton} type="button" onClick={() => void settleConflicts('mine')} className="shrink-0 rounded-sm font-medium underline">
            {conflicts.size === 1 ? 'Keep my version' : 'Keep my versions'}
          </button>
          <button type="button" onClick={() => void settleConflicts('saved')} className="shrink-0 rounded-sm font-medium underline">
            {conflicts.size === 1 ? 'Use the saved copy' : 'Use the saved copies'}
          </button>
        </div>
      ) : (
        (start.isError || writeError || running.data?.status === 'error') && (
          <p role="alert" className="flex items-center gap-3 border-b border-refutes bg-refutes-soft px-4 py-1.5 text-xs text-refutes">
            <span className="min-w-0 flex-1">
              {writeError ?? (start.isError ? `Re-check failed: ${errorMessage(start.error)}` : `The check failed: ${shortMessage(running.data?.message)}`)}
              {writeError && ' Your text is kept on this device until it is saved.'}
            </span>
            {writeError && (
              <button type="button" onClick={() => void flush()} className="shrink-0 rounded-sm font-medium underline">
                Retry now
              </button>
            )}
          </p>
        )
      )}
      {recovery && offering && (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-insufficient bg-insufficient-soft px-4 py-1.5 text-xs text-insufficient">
          <span className="min-w-0 flex-1">
            Unsaved edits to {recoverable.map(([name]) => name).join(', ')} from {new Date(recovery.at).toLocaleString()} were kept on this device.
          </span>
          <button
            type="button"
            onClick={() => {
              for (const [name, content] of recoverable) onChange(name, content)
              setRecovery(null)
            }}
            className="shrink-0 rounded-sm font-medium underline"
          >
            Restore them
          </button>
          <button
            type="button"
            onClick={() => {
              dropBackup(draftId)
              setRecovery(null)
            }}
            className="shrink-0 rounded-sm font-medium underline"
          >
            Discard
          </button>
        </div>
      )}
      {draft.data.bibFork && (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-insufficient bg-insufficient-soft px-4 py-1.5 text-xs text-insufficient">
          <span className="min-w-0 flex-1">
            This draft has its own copy of {draft.data.bibFork}, so changes to the project’s {draft.data.bibFork} do not reach it.
          </span>
          <button type="button" disabled={settlingFork} onClick={() => void settleFork('project')} className="shrink-0 rounded-sm font-medium underline disabled:opacity-60">
            Use the project’s .bib
          </button>
          <button type="button" disabled={settlingFork} onClick={() => void settleFork('draft')} className="shrink-0 rounded-sm font-medium underline disabled:opacity-60">
            Keep this draft’s copy
          </button>
        </div>
      )}
      {offeredTitle && (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-1.5 text-xs text-ink-muted">
          <span className="min-w-0 flex-1">
            Name this draft “{offeredTitle}”, from its \title?
          </span>
          <button
            type="button"
            onClick={() => void rename(offeredTitle).then((refused) => (refused ? toast.error(refused) : setTitleOfferDismissed(true)))}
            className="shrink-0 rounded-sm font-medium text-accent underline"
          >
            Use this title
          </button>
          <button type="button" onClick={() => setTitleOfferDismissed(true)} className="shrink-0 rounded-sm font-medium underline">
            Not now
          </button>
        </div>
      )}
      <SplitPane
        leftLabel="Source"
        rightLabel="Preview"
        separatorLabel="Resize the editor and the preview"
        left={
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <FileTabs
              files={filesWithDirty}
              active={active.name}
              onSelect={selectFile}
              onAdd={(name) => {
                void actions
                  .putFile(draftId, name, '')
                  .then((added) => {
                    // Adding a file moves the draft's `updated`; the next write carries it.
                    lastUpdated.current = added.updated
                    selectFile(name)
                  })
                  .catch((error) => toast.error(`Could not add ${name}: ${errorMessage(error)}`))
              }}
            />
            <CodeEditor
              key={`${draftId}:${active.name}`}
              ariaLabel={`${active.name} source`}
              value={text}
              marks={marks}
              problems={activeProblems}
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
            onAskToFix={askToFix}
          />
        }
      />
    </div>
  )
}
