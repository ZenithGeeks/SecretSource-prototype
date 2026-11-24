/**
 * The labeling workspace: one claim at a time, with the reference it cites and, on request, the
 * paper that makes it.
 *
 * Everything is decided by the person here. The page only shows what the system found (claims,
 * passages) and writes what the person decides. A claim is saved on its own, so a half-labeled
 * paper is never lost and two people can work on different papers at once. Ask AI can review a
 * saved claim; it points things out and never changes a label.
 */

import { useQueries, useQuery } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { EyeOff, Keyboard } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ToolbarActions } from '../../../components/AppShell'
import { PageViewer, type Target } from '../../../components/PageViewer'
import { Button, Empty, LoadingScreen, Segmented, TextButton } from '../../../components/ui'
import { api, type Citation, type CitationMarker } from '../../../lib/api'
import { askTarget, type Pointing } from '../../../lib/askCursor'
import { printedRef } from '../../../lib/claimText'
import { useFoldWhile } from '../../../lib/foldSidebar'
import { cn } from '../../../lib/utils'
import {
  type AddedPassage,
  bestCandidate,
  changeCount,
  citedReferences,
  buildSave,
  byline,
  displayOrder,
  draftFromSaved,
  editNotReworded,
  emptyDraft,
  emptyLabel,
  LEVELS,
  labelingApi,
  nextPaperInTopic,
  nextUnfinishedIndex,
  progress,
  readUnsaved,
  relevantPassages,
  remainingSteps,
  referenceName,
  referencesOf,
  sameDraft,
  unresolvedCitations,
  saveNextTarget,
  problem,
  usePool,
  useSaveLabels,
  workClaims,
  writeUnsaved,
  type Candidate,
  type ClaimStatus,
  type Confidence,
  type Draft,
  type LabelDraft,
  type Level,
  type Reference,
  type Session,
  type Step,
  type WorkClaim,
  useLabelSession,
} from '../../../lib/labeling'
import { AiCursor } from '../../../components/AiCursor'
import { SplitPane } from '../../../components/SplitPane'
import { AskPanel, type AskedPassage } from '../components/AskPanel'
import { ClaimDecision, ClaimHeading, ClaimSticky, Kbd } from '../components/ClaimDecision'
import { ClaimNav } from '../components/ClaimNav'
import { GuideButton } from '../components/GuideButton'
import { LabelForm } from '../components/LabelForm'
import { PassageList, revealInPanel, type Focus } from '../components/PassageList'
import { SaveBar } from '../components/SaveBar'
import { SelectionBar, type Picked } from '../components/SelectionBar'
import { UnresolvedList, UnresolvedReferences } from '../components/UnresolvedReferences'

const VIEWER_HEIGHT = 'h-[60vh]'

const VIEW_KEY = 'labeler.paperView'
const NOTICE_MS = 4000
const HIGHLIGHT_MS = 1500 // how long what an undo put back stays outlined
const UNDO_STEPS = 20 // per claim, so a long session does not keep every snapshot
const SPLIT_KEY = 'labeler.panelRatio' // the paper's share of the width, kept by SplitPane
// The paper's share of the height in Stacked view. A new key: the old one held the reference's share.
const STACKED_SPLIT_KEY = 'labeler.stackedPaperRatio'
// The claim panel never gets narrower than this: it was a fixed 27rem before it could be resized.
const PANEL_MIN_PX = 432
// Side by side, two PDFs share the rest, so the panel may be narrower and has a ratio of its own.
const SIDE_SPLIT_KEY = 'labeler.sidePanelRatio'
const SIDE_PANEL_MIN_PX = 384
const SIDE_PAPERS_KEY = 'labeler.sidePaperRatio' // the paper under review's share beside the reference
// The least a PDF pane gets, side by side or stacked. Stacked, the papers column scrolls when the
// window is too short for two: at 200px each, a pane showed a strip of a page.
const PDF_MIN_PX = 320
// Below this a side-by-side pane shows a two-column page too small to read.
const READABLE_PANE_PX = 520
const GUTTER_PX = 12 // the space between the handle and the panel (ml-3), outside the panel's box
type PaperView = 'both' | 'reference' | 'side'
const VIEW_NAMES: Record<PaperView, string> = {
  side: 'Side by side',
  both: 'Stacked',
  reference: 'Reference only',
}
/** Side by side needs room: a two-column paper needs a page about 700px wide to read. With the
 * label panel (27rem) and the sidebar folded, two columns get that from 1600px up, so the choice
 * is offered only there; narrower windows fall back to the stacked view. */
const SIDE_BY_SIDE_FROM = 1600
const storedView = (): PaperView => {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY)
    if (stored === 'reference' || stored === 'both' || stored === 'side') return stored
  } catch {
    // no stored choice: the reference alone, the paper that gets judged
  }
  return 'reference'
}

function useMinWidth(px: number) {
  const query = `(min-width: ${px}px)`
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Passages the live search found, rather than ones the analysis stored. A hand-added claim is
 * always searched. An extracted claim is searched only while it has none, so once results
 * arrive every passage is from that search. */
const passagesFromSearch = (claim: WorkClaim) =>
  claim.origin === 'human_added' || (claim.candidates.length > 0 && claim.candidates.every((c) => c.fromSearch))

const firstFocus = (claim: WorkClaim, session: Session): Focus | null => {
  // Passages from several references at once: take the best one. An extracted claim's own
  // first passage is already the one retrieval ranked first.
  const c = passagesFromSearch(claim) ? bestCandidate(claim, session.references) : claim.candidates[0]
  if (c) return { file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id, automatic: true }
  // No passages: the first reference the claim itself cites that has a PDF, at page 1. Never the
  // analysis's first reference, which may be one this claim does not cite. With none, nothing
  // opens and the pane lists the claim's unresolved citations instead.
  const ref = citedReferences(claim, session.references)[0]
  return ref ? { file: ref.file, passage: '', page: 1, key: `ref:${ref.reference_id}` } : null
}

/** "Reference [14]: title", with the number the paper prints, so it reads with the PDF. */
function referenceLabel(reference: Reference | null | undefined, markers: CitationMarker[] = []): string {
  if (!reference) return 'Reference'
  const printed = printedRef(reference, markers)
  return printed ? `Reference ${printed}: ${reference.label}` : `Reference: ${reference.label}`
}

/** A reference in a few words: the number the paper prints for it ("[7]"), else who wrote it,
 * else its title. */
function referenceTag(reference: Reference | undefined, markers: CitationMarker[] = []): string {
  if (!reference) return 'this reference'
  return printedRef(reference, markers) || byline(reference) || reference.label
}

/** A decision as its button names it, for the undo notice. */
const DECISION_WORDS: Record<ClaimStatus, string> = { accepted: 'Keep', edited: 'Edit', rejected: 'Reject' }

const levelWords = (tag: string, level: Level | null) => `${tag} level ${level ? `${level} ${LEVELS[level - 1].name}` : 'cleared'}`
const confidenceWords = (tag: string, confidence: Confidence | null) =>
  `${tag} confidence ${confidence ? confidence[0].toUpperCase() + confidence.slice(1) : 'cleared'}`

/** What a change in the level form did, in the words of the key notices; empty for typing. */
function labelChangeWords(tag: string, before: LabelDraft, after: LabelDraft): string {
  if (after.evidence !== before.evidence) return levelWords(tag, after.evidence)
  if (after.confidence !== before.confidence) return confidenceWords(tag, after.confidence)
  return ''
}

/** The keyboard shortcuts, in the order the work is done. */
const SHORTCUT_GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: 'Decide', keys: [['K', 'keep'], ['E', 'edit'], ['X', 'reject'], ['Z', 'undo']] },
  { title: 'Judge passage', keys: [['R', 'relevant'], ['N', 'not relevant'], ['1–4', 'level'], ['L M H', 'how sure']] },
  {
    title: 'Navigate',
    keys: [['J', 'next passage'], ['U', 'previous passage'], [']', 'next claim'], ['[', 'previous claim'], ['F', 'next unfinished']],
  },
  { title: 'Save', keys: [['Ctrl/⌘+S', 'save this claim'], ['Ctrl/⌘+Shift+S', 'save all unsaved'], ['?', 'show or hide this list']] },
]

/** True when `change` only edits text (the claim's wording, a level's reason), not a choice. */
function isTyping(change: Partial<Draft>, before: Draft): boolean {
  if (change.edited !== undefined) return change.status === undefined
  if (!change.labels || Object.keys(change).length > 1) return false
  return Object.entries(change.labels).every(([id, label]) => {
    const old = before.labels[id] ?? emptyLabel()
    return label.evidence === old.evidence && label.confidence === old.confidence
  })
}

type UndoStep = { draft: Draft; focus: Focus | null; what: string; cleared?: true }

/** Where on the page an undo put something back: the decision, a passage's verdict, or a level form. */
function undoTarget(step: UndoStep, current: Draft): string | null {
  const back = step.draft
  if (step.cleared || back.status !== current.status || back.edited !== current.edited) return '#claim-decision'
  const passage = Object.keys({ ...back.cands, ...current.cands }).find((id) => back.cands[id] !== current.cands[id])
  if (passage) return `[data-ask-target="${askTarget({ kind: 'passage', id: passage })}"]`
  const reference = Object.keys({ ...back.labels, ...current.labels }).find(
    (id) => JSON.stringify(back.labels[id]) !== JSON.stringify(current.labels[id]),
  )
  if (reference) return `[data-ask-target="${askTarget({ kind: 'reference', id: reference })}"] [data-level-form]`
  return null
}

/** "claim 3" or "claims 3, 5". */
const claimNumbers = (numbers: number[]) => `${numbers.length === 1 ? 'claim' : 'claims'} ${numbers.join(', ')}`

type WorkspaceProps = {
  analysisId: string
  onDirtyChange?: (unsaved: boolean) => void
  /** The Ask panel's "This claim" view (LabelerApp), while it shows; the claim tools are drawn there. */
  askSlot?: HTMLElement | null
  /** Opens the Ask panel on "This claim", for a passage the labeler asks about. */
  onOpenAsk?: () => void
  /** Leaves the paper for the list. */
  onBack?: () => void
  /** Opens another paper, used when this one is finished. */
  onOpenPaper?: (id: string) => void
  /** Whether the open paper is a blind check, so the shell can drop Ask from its toolbar. */
  onBlindChange?: (blind: boolean) => void
}

export function Workspace({ analysisId, onDirtyChange, askSlot = null, onOpenAsk, onBack, onOpenPaper, onBlindChange }: WorkspaceProps) {
  const query = useLabelSession(analysisId)
  const blind = query.data?.blind ?? false
  useEffect(() => {
    onBlindChange?.(blind)
    return () => onBlindChange?.(false)
  }, [blind, onBlindChange])
  if (query.isLoading) return <LoadingScreen label="Opening the paper's claims…" />
  if (query.error || !query.data) {
    const fail = problem(query.error)
    return (
      <div className="flex flex-col items-center gap-3">
        <Empty title={fail.title} hint={fail.hint} />
        <Button variant="ghost" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <Body
      key={analysisId}
      session={query.data}
      onDirtyChange={onDirtyChange}
      askSlot={askSlot}
      onOpenAsk={onOpenAsk}
      onBack={onBack}
      onOpenPaper={onOpenPaper}
    />
  )
}

/** Search for passages the analysis did not store, and add what is found (#404, #836).
 *
 * A hand-added claim is searched when it is opened. An extracted claim is searched the same
 * way when it has no passages: one that only names a work was never checked, though another
 * claim may have downloaded that work. An extracted claim that already has passages is not
 * searched. A search for a claim not in view is disabled but still returns what it found
 * before. Passages judged and saved earlier stay in the list even when a new search ranks
 * them out. */
function useAddedClaimSearch(analysisId: string, listed: WorkClaim[], currentId: string) {
  const pending = listed.filter((c) => c.origin === 'human_added' || c.candidates.length === 0)
  const searches = useQueries({
    queries: pending.map((c) => ({
      queryKey: ['labeling', 'candidates', analysisId, c.claim_id, c.claim],
      queryFn: () => labelingApi.candidates(analysisId, c.claim_id, c.claim),
      enabled: c.claim_id === currentId,
      staleTime: Infinity,
      retry: false,
    })),
  })
  const searchOf = new Map(pending.map((c, i) => [c.claim_id, searches[i]]))
  const claims = listed.map((c) => {
    const found = searchOf.get(c.claim_id)?.data?.candidates
    if (!found) return c
    const known = new Set(c.candidates.map((cand) => cand.cand_id))
    const extra = found
      .filter((cand) => !known.has(cand.cand_id))
      .map((cand) => ({ ...cand, fromSearch: true as const }))
    return { ...c, candidates: [...c.candidates, ...extra] }
  })
  const current = searchOf.get(currentId)
  let search: 'searching' | 'failed' | undefined
  if (current?.isFetching) search = 'searching'
  else if (current?.isError) search = 'failed'
  return { claims, search, searchAgain: () => void current?.refetch() }
}


function Body({
  session,
  onDirtyChange,
  askSlot,
  onOpenAsk,
  onBack,
  onOpenPaper,
}: {
  session: Session
  onDirtyChange?: (unsaved: boolean) => void
  askSlot: HTMLElement | null
  onOpenAsk?: () => void
  onBack?: () => void
  onOpenPaper?: (id: string) => void
}) {
  const base = useMemo(() => workClaims(session), [session])
  // What this browser kept from before a reload or an outage, put back on top of what was saved.
  const [restored] = useState(() => readUnsaved(session.analysis_id, session.annotator))
  const [extra, setExtra] = useState<WorkClaim[]>(() => restored?.added ?? [])
  const listed = useMemo(
    () => [...base, ...extra.filter((e) => !base.some((b) => b.claim_id === e.claim_id))],
    [base, extra],
  )
  // Each claim as last written, to know what changed.
  const [saved, setSaved] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(base.map((c) => [c.claim_id, draftFromSaved(c, session.saved)])),
  )
  const [drafts, setDrafts] = useState(() => ({ ...saved, ...restored?.drafts }))
  const [currentId, setCurrentId] = useState(listed[0]?.claim_id ?? '')
  const [paperDone, setPaperDone] = useState(false)
  // The header moves between the workspace and toolbar, so keep its unfinished entry here.
  const [addingClaim, setAddingClaim] = useState(false)
  const [claimText, setClaimText] = useState('')
  // `id` tells two notices with the same words apart: a second "Nothing to undo" restarts the
  // timer and is read out again, where the same string would change nothing.
  const [notice, setNoticeShown] = useState<{ text: string; id: number; keep: boolean } | null>(null)
  const noticeCount = useRef(0)
  const setNotice = (text: string | null, keep = false) =>
    setNoticeShown(text ? { text, id: ++noticeCount.current, keep } : null)
  // A notice is about the last action only, so it goes after a few seconds. One that says what an
  // undo did, or what Save all left unsaved, stays until the next action: it takes longer to read.
  useEffect(() => {
    if (!notice || notice.keep) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])
  const panelScrollRef = useRef<HTMLDivElement>(null)
  const undos = useRef<Record<string, UndoStep[]>>({})
  // Counts the labeler's own picks of Edit; only those move the focus into the reword box.
  const [editPicks, setEditPicks] = useState(0)
  // Counts the times the decision takes the focus: after Clear or Discard and after undoing a decision.
  const [decisionTurns, setDecisionTurns] = useState(0)
  // What the last undo put back, or where a save bar step is done, to scroll to and outline for a
  // moment. `focus` picks the control inside it that takes the keyboard focus.
  const [flash, setFlash] = useState<{ selector: string; id: number; focus?: string } | null>(null)
  // What Save all could not save, shown on the save bar's error line.
  const [saveAllError, setSaveAllError] = useState<string | null>(null)
  // An unchanged Edit is shown as a hint until the labeler tries to save it, then as a warning.
  const [saveTried, setSaveTried] = useState(false)
  const pool = usePool()
  const { claims, search, searchAgain } = useAddedClaimSearch(session.analysis_id, listed, currentId)
  const claim = claims.find((c) => c.claim_id === currentId)
  const draft = (claim && drafts[claim.claim_id]) || emptyDraft()
  // A claim added by hand has no position in the paper. Look its text up the way a reference
  // passage is looked up, so it is boxed on its page like an extracted claim (#403). Text that
  // is not in the paper (a claim typed in) finds nothing and simply gets no box.
  const placed = useQuery({
    queryKey: ['find', session.paper_file, claim?.sentence || claim?.claim, claim?.page],
    queryFn: () =>
      api.findInPaper(session.paper_file, (claim!.sentence || claim!.claim).slice(0, 300), claim!.page ?? undefined),
    enabled: claim?.origin === 'human_added' && !claim.source,
    staleTime: Infinity,
    retry: false,
  })
  const claimSource = claim?.source ?? (placed.data?.page ? placed.data : null)
  const [focus, setFocus] = useState<Focus | null>(() => (claims[0] ? firstFocus(claims[0], session) : null))
  // The passage the labeler asked Ask about. `id` counts the asks, so asking again (even about
  // the same passage) starts a fresh question; moving to another claim drops it.
  const [asked, setAsked] = useState<{ claimId: string; passage: AskedPassage | null; id: number } | null>(null)
  if (asked && asked.claimId !== currentId) setAsked(null)
  const [overlay, setOverlay] = useState<'paper' | 'reference' | null>(null)
  const [savedRows, setSavedRows] = useState<number | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null) // text just selected in a PDF
  const [paperView, setPaperView] = useState<PaperView>(storedView)
  const choosePaperView = (choice: PaperView) => {
    // Picking the view already on screen keeps the stored choice: on a claim with no reference,
    // Stacked is shown in place of Reference only, which stays the choice for the other claims.
    if (choice === shownView) return
    setPaperView(choice)
    setNotice(null)
    try {
      window.localStorage.setItem(VIEW_KEY, choice)
    } catch {
      // the choice just is not remembered
    }
  }
  const wide = useMinWidth(1024) // Tailwind lg, where AppShell locks the shell to the window
  // The header row fits in the top bar beside the breadcrumb and Ask AI only from 1280px.
  const inBar = useMinWidth(1280)
  const roomy = useMinWidth(SIDE_BY_SIDE_FROM)
  const view: PaperView = paperView === 'side' && !roomy ? 'both' : paperView
  // With no reference to open, Reference only would hide the paper, the one thing left to judge
  // from, so that claim gets the stacked view: the not-found card above the paper.
  const noReference = view === 'reference' && !focus?.file
  const shownView: PaperView = noReference ? 'both' : view
  const both = shownView === 'both'
  const side = view === 'side'
  // Two papers side by side need the sidebar's width too: with it open, body text came out about
  // 6px. Leaving Side by side, or the paper, opens it again; the labeler can open it any time.
  useFoldWhile(side)
  const save = useSaveLabels(session.analysis_id)

  const go = (id: string) => {
    const next = claims.find((c) => c.claim_id === id)
    setCurrentId(id)
    // Every id that reaches go() is a listed claim, so `next` is set; the check only satisfies the type.
    /* v8 ignore next -- @preserve */
    setFocus(next ? firstFocus(next, session) : null)
    setSavedRows(null)
    setPicked(null)
    setPaperDone(false)
    setNotice(null)
    setSaveTried(false)
    setSaveAllError(null)
    save.reset()
    /* v8 ignore next -- @preserve */
    if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0
  }

  // A searched claim has no passages until its search answers, so it opens on nothing, or on a
  // reference its sentence cites at page 1 (a `ref:` focus). When the passages arrive, open the
  // best one, once per claim. A passage the person opened is kept; reading that first page is not.
  const autoOpened = useRef(new Set<string>())
  useEffect(() => {
    if (!claim || !passagesFromSearch(claim) || autoOpened.current.has(claim.claim_id)) return
    const first = firstFocus(claim, session)
    if (!first?.passage) return
    autoOpened.current.add(claim.claim_id)
    if (!focus || focus.key.startsWith('ref:')) setFocus(first)
  }, [claim, focus, session])

  // Moving to another claim keeps the draft of the one being left: it stays marked unsaved until
  // it is saved, and nothing is written that the person did not save.
  const select = (id: string) => {
    if (id === currentId || save.isPending) return
    go(id)
  }

  // Edit starts from the extracted wording, so a small fix is not a full retype.
  const writeDraft = (change: Partial<Draft>) =>
    setDrafts((all) => {
      // patch() runs only while a claim with a draft is on screen; `?? emptyDraft()` and `&& claim` only satisfy the types.
      /* v8 ignore start -- @preserve */
      const before = all[currentId] ?? emptyDraft()
      const start = change.status === 'edited' && !before.edited && claim ? { edited: claim.claim } : {}
      /* v8 ignore stop -- @preserve */
      return { ...all, [currentId]: { ...before, ...start, ...change } }
    })
  // Every choice, by key or by click, goes on the claim's undo stack, which Z walks back. Typing
  // in a text box does not, or Z would take back one letter. A notice from an earlier action is cleared.
  const remember = (what: string, cleared?: true) => {
    const steps = undos.current[currentId] ?? []
    undos.current[currentId] = [...steps, { draft: structuredClone(draft), focus, what, cleared }].slice(-UNDO_STEPS)
  }
  const patch = (change: Partial<Draft>, what: string) => {
    if (!isTyping(change, draft)) {
      remember(what)
      setNotice(null)
    }
    if (change.status) setSaveTried(false)
    writeDraft(change)
  }
  const keyed = (change: Partial<Draft>, text: string) => {
    patch(change, text)
    setNotice(`${text} · Z to undo`)
  }

  const dirty = !sameDraft(draft, saved[currentId])
  // Edit with the wording left as extracted is no change of wording: Keep says that.
  let saveBlocked: string | null = null
  if (claim && editNotReworded(claim, draft)) saveBlocked = "Can't save yet: reword the claim, or choose Keep."
  // A claim with no decision saves no row, so its passages would look saved and be lost.
  else if (dirty && !draft.status) saveBlocked = "Can't save yet: keep, edit or reject the claim."
  const anyDirty = Object.keys(drafts).some((id) => !sameDraft(drafts[id], saved[id]))

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsButtonRef = useRef<HTMLButtonElement>(null)
  // One popover at a time: the shortcuts and the add-claim form open over the same corner.
  const toggleShortcuts = () => {
    setShortcutsOpen((open) => !open)
    setAddingClaim(false)
  }
  const setAdding = (open: boolean) => {
    setAddingClaim(open)
    if (open) setShortcutsOpen(false)
  }
  // Focus moves to the list as it opens, so a screen reader announces it.
  const shortcutsRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (shortcutsOpen) shortcutsRef.current?.focus({ preventScroll: true })
  }, [shortcutsOpen])
  // Kept with the claim it was for, so moving to another claim drops the cursor at once.
  const [pointing, setPointing] = useState<{ claimId: string; at: Pointing } | null>(null)
  const point = useCallback((at: Pointing | null) => setPointing(at && { claimId: currentId, at }), [currentId])
  // The review reads what was saved, so the person's own decision always comes first.
  let reviewBlocked: string | null = null
  if (!saved[currentId]?.status) reviewBlocked = 'Save this claim first: the review checks what you saved.'
  else if (dirty) reviewBlocked = 'Save your changes first: the review checks what you saved.'
  const position = claims.findIndex((c) => c.claim_id === currentId)
  // Cited works with no PDF can still get a passage and a level (#824); they never open in the viewer.
  const cited = [...session.references, ...(session.unread ?? [])]
  const steps = claim ? remainingSteps(claim, draft, cited, session.markers) : []
  const left = steps.map((step) => step.text)

  const write = (next: boolean) => {
    // Save is offered, and Ctrl+S allowed, only with a claim on screen.
    /* v8 ignore next -- @preserve */
    if (!claim) return
    const index = claims.findIndex((c) => c.claim_id === claim.claim_id)
    const target = saveNextTarget(claims, drafts, saved, cited, index)
    const body = buildSave({ ...claim, source: claimSource }, draft, saved[claim.claim_id])
    setSaveAllError(null)
    save.mutate(body, {
      onSuccess: (rows) => {
        setSaved((all) => ({ ...all, [claim.claim_id]: structuredClone(draft) }))
        setSavedRows(rows.claims + rows.candidates + rows.labels)
        if (!next) return
        if (target.kind === 'claim') go(claims[target.index].claim_id)
        setPaperDone(target.kind === 'paper-done')
      },
    })
  }

  // Every claim with unsaved changes, one after another through the same save as one claim. It
  // stops at the first failure, so the error line can say which claims were saved and which not.
  // A claim that cannot be saved yet (no decision, or an Edit not reworded) is skipped and named.
  const saveAll = async () => {
    const changed = claims.flatMap((c, index) => {
      const d = drafts[c.claim_id]
      return d && !sameDraft(d, saved[c.claim_id]) ? [{ claim: c, draft: d, number: index + 1 }] : []
    })
    if (changed.length === 0) {
      setNotice('Nothing to save')
      return
    }
    const undecided = changed.filter((item) => !item.draft.status).map((item) => item.number)
    const skipped = changed.filter((item) => editNotReworded(item.claim, item.draft)).map((item) => item.number)
    const ready = changed.filter((item) => item.draft.status && !editNotReworded(item.claim, item.draft))
    const notSaved = [
      undecided.length ? `${claimNumbers(undecided)} not saved: keep, edit or reject the claim` : '',
      skipped.length ? `${claimNumbers(skipped)} not saved: reword the claim, or choose Keep` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const done: number[] = []
    setSaveAllError(null)
    setSavedRows(null)
    for (const [at, item] of ready.entries()) {
      // The claim on screen may have been placed in the paper by a lookup; the others keep their own source.
      const source = item.claim.claim_id === currentId ? claimSource : item.claim.source
      try {
        await save.mutateAsync(buildSave({ ...item.claim, source }, item.draft, saved[item.claim.claim_id]))
      } catch (error) {
        const fail = problem(error)
        const failed = `${claimNumbers(ready.slice(at).map((rest) => rest.number))}: ${fail.title}. ${fail.hint}`
        setSaveAllError([failed, notSaved, done.length ? `${claimNumbers(done)} saved` : ''].filter(Boolean).join(' · '))
        return
      }
      done.push(item.number)
      setSaved((all) => ({ ...all, [item.claim.claim_id]: structuredClone(item.draft) }))
    }
    setNotice([`${done.length} saved`, notSaved].filter(Boolean).join(' · '), Boolean(notSaved))
  }

  useEffect(() => {
    const unsaved = Object.fromEntries(Object.entries(drafts).filter(([id, d]) => !sameDraft(d, saved[id])))
    const added = extra.filter((c) => unsaved[c.claim_id])
    writeUnsaved(session.analysis_id, session.annotator, { drafts: unsaved, added })
  }, [drafts, saved, extra, session.analysis_id, session.annotator])

  // Tell the app whether leaving would lose work; leaving the workspace clears it.
  useEffect(() => {
    onDirtyChange?.(anyDirty)
  }, [anyDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const deciding = Boolean(draft.status) && draft.status !== 'rejected'
  const ordered = claim ? displayOrder(claim) : []
  const focusPassage = (c: Candidate) =>
    setFocus({ file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id })
  const focusAdded = (p: AddedPassage) => {
    const file = session.references.find((r) => r.reference_id === p.reference_id)?.file ?? ''
    setFocus({ file, passage: p.passage, page: p.page, key: `added:${p.reference_id}:${p.passage}` })
  }

  // Keys: Ctrl/⌘+S saves; K/E/X decide the claim; R/N judge the focused passage; J/U (or the
  // up and down arrows) move between passages; [ ] (or Shift+left/right) between claims;
  // 1-4 label the reference in view, once it has a relevant passage.
  const refId = claim && focus ? session.references.find((r) => r.file === focus.file)?.reference_id : undefined
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (save.isPending) return
        if (event.shiftKey) void saveAll()
        else if (saveBlocked) setSaveTried(true)
        else if (dirty) write(false)
        return
      }
      const typing =
        event.target instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable)
      if (typing || event.ctrlKey || event.metaKey || event.altKey || !claim) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const stepPassage = (delta: 1 | -1) => {
        if (!deciding || !ordered.length) return
        event.preventDefault()
        const at = ordered.findIndex((c) => c.cand_id === focus?.key)
        const to = at < 0 ? (delta > 0 ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, at + delta))
        focusPassage(ordered[to])
      }
      const stepClaim = (delta: 1 | -1) => {
        event.preventDefault()
        const to = claims[position + delta]
        if (to) select(to.claim_id)
      }

      if (key === '?') {
        toggleShortcuts()
        return
      }
      if (key === 'Escape' && shortcutsOpen) {
        // Focus was in the list; put it back on the button rather than lose it with the list.
        setShortcutsOpen(false)
        shortcutsButtonRef.current?.focus()
        return
      }
      if (key === 'z') {
        const snap = undos.current[currentId]?.pop()
        event.preventDefault()
        if (!snap) {
          // Undo is per claim, so point to the other claims with unsaved changes.
          const others = claims.flatMap((c, index) =>
            c.claim_id !== currentId && drafts[c.claim_id] && !sameDraft(drafts[c.claim_id], saved[c.claim_id]) ? [index + 1] : [],
          )
          const where = others.length ? ` · ${claimNumbers(others)} ${others.length === 1 ? 'has' : 'have'} changes` : ''
          setNotice(`Nothing to undo on this claim${where}`)
          return
        }
        const target = undoTarget(snap, draft)
        setDrafts((all) => ({ ...all, [currentId]: snap.draft }))
        setFocus(snap.focus)
        setNotice(`Undone: ${snap.what}`, true)
        if (target) setFlash({ selector: target, id: noticeCount.current })
        // The decision's buttons can change under the focus; put it on the decision, never the reword box.
        if (target === '#claim-decision') setDecisionTurns((n) => n + 1)
        return
      }
      // An added passage on an unread reference does not have a PDF.
      const labelRefId = refId ?? draft.added.find((p) => focus?.key === `added:${p.reference_id}:${p.passage}`)?.reference_id
      const refTag = referenceTag(cited.find((r) => r.reference_id === labelRefId), session.markers)
      // A handled letter must not also be typed: E opens the edit box, which takes the focus.
      if (['k', 'e', 'x', 'r', 'n', 'l', 'm', 'h', '1', '2', '3', '4'].includes(key)) event.preventDefault()
      if (key === 'k') keyed({ status: 'accepted' }, DECISION_WORDS.accepted)
      else if (key === 'e') {
        keyed({ status: 'edited' }, DECISION_WORDS.edited)
        setEditPicks((n) => n + 1)
      }
      else if (key === 'x') keyed({ status: 'rejected' }, DECISION_WORDS.rejected)
      else if (key === 'r' || key === 'n') {
        const current = ordered.find((c) => c.cand_id === focus?.key)
        if (!deciding || !current) return
        const status = key === 'r' ? ('relevant' as const) : ('rejected' as const)
        const cands = { ...draft.cands, [current.cand_id]: status }
        keyed({ cands }, `Passage ${current.rank} ${status === 'relevant' ? 'relevant' : 'not relevant'}`)
        const at = ordered.indexOf(current)
        const next = [...ordered.slice(at + 1), ...ordered.slice(0, at)].find((c) => !cands[c.cand_id])
        if (next) focusPassage(next)
      } else if (key === 'j' || key === 'ArrowDown') stepPassage(1)
      else if (key === 'u' || key === 'ArrowUp') stepPassage(-1)
      else if (key === ']' || (key === 'ArrowRight' && event.shiftKey)) stepClaim(1)
      else if (key === '[' || (key === 'ArrowLeft' && event.shiftKey)) stepClaim(-1)
      else if (key === 'f') {
        event.preventDefault()
        const index = nextUnfinishedIndex(claims, drafts, saved, cited, position)
        if (index != null) select(claims[index].claim_id)
      }
      else if (['1', '2', '3', '4'].includes(key) && deciding && labelRefId && relevantPassages(claim, draft, labelRefId).length > 0) {
        const label = draft.labels[labelRefId] ?? emptyLabel()
        const level = Number(key) as Level
        keyed({ labels: { ...draft.labels, [labelRefId]: { ...label, evidence: level } } }, levelWords(refTag, level))
      } else if (['l', 'm', 'h'].includes(key) && deciding && labelRefId && relevantPassages(claim, draft, labelRefId).length > 0) {
        const label = draft.labels[labelRefId] ?? emptyLabel()
        const confidence = key === 'l' ? 'low' : key === 'm' ? 'medium' : 'high'
        keyed({ labels: { ...draft.labels, [labelRefId]: { ...label, confidence } } }, confidenceWords(refTag, confidence))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!anyDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyDirty])

  // Shows what an undo put back, or where a save bar step is done: scrolled into view and outlined
  // for a moment. An inline style, not a class, so it never fights the classes React sets, and
  // nothing moves for reduced motion.
  useEffect(() => {
    const element = flash && document.querySelector<HTMLElement>(flash.selector)
    if (!element) return
    revealInPanel(element)
    if (flash.focus) element.querySelector<HTMLElement>(flash.focus)?.focus({ preventScroll: true })
    element.style.outline = '2px solid var(--color-accent)'
    element.style.outlineOffset = '2px'
    const clear = () => {
      element.style.outline = ''
      element.style.outlineOffset = ''
    }
    const timer = window.setTimeout(clear, HIGHLIGHT_MS)
    return () => {
      window.clearTimeout(timer)
      clear()
    }
  }, [flash])

  // Side by side, each pane is measured: too narrow to read, the papers area offers Stacked.
  const papersRef = useRef<HTMLDivElement>(null)
  const [panesNarrow, setPanesNarrow] = useState(false)
  useEffect(() => {
    const box = papersRef.current
    // jsdom, which the tests run in, has no ResizeObserver unless a test gives it one.
    if (!side || !box || typeof ResizeObserver === 'undefined') return
    const panes = [...box.querySelectorAll<HTMLElement>('section[aria-label="Paper under review"], section[aria-label="Cited reference"]')]
    const observer = new ResizeObserver(() => setPanesNarrow(panes.some((pane) => pane.clientWidth < READABLE_PANE_PX)))
    panes.forEach((pane) => observer.observe(pane))
    return () => observer.disconnect()
  }, [side, wide])

  const found = useQuery({
    queryKey: ['find', focus?.file, focus?.passage, focus?.page],
    // The whole passage: a 300-character prefix highlighted only the start of a long one.
    queryFn: () => api.findInPaper(focus!.file, focus!.passage, focus?.page ?? undefined),
    enabled: Boolean(focus?.file && focus.passage),
    staleTime: Infinity,
    retry: false,
  })

  if (!claim) return <Empty title="No claims in this paper" hint="Extraction found none. Add one by hand below." />

  const left_: Target = {
    paper: session.paper_file,
    paperRole: 'under-review',
    label: session.title,
    quote: claim.sentence || claim.claim,
    source: claimSource,
    page: claimSource?.page ?? claim.page ?? 1,
  }
  const shown = focus && session.references.find((r) => r.file === focus.file)
  // A passage added for a work with no PDF has no file, so no reference opens for it.
  const right: Target | null = focus?.file
    ? {
        paper: focus.file,
        paperRole: 'reference',
        label: referenceLabel(shown, session.markers),
        detail: shown ? byline(shown) : undefined,
        quote: focus.passage || undefined,
        source: found.data && found.data.page ? found.data : null,
        page: focus.page ?? 1,
        error: found.isError ? 'Could not look up where this passage is.' : undefined,
      }
    : null
  // Any reference that was read can be opened, to select a passage retrieval missed in it: from
  // the list, or by clicking where the paper under review cites it. A citation of a reference
  // that was not read keeps the PDF's own link to the reference list.
  const openReference = (r: Reference) => {
    setFocus({ file: r.file, passage: '', page: 1, key: `ref:${r.reference_id}` })
    setPicked(null)
  }
  const readRefs = Object.fromEntries(session.references.flatMap((r) => (r.ref ? [[r.ref, r] as const] : [])))
  const citing = {
    markers: (session.markers ?? []).filter((m) => readRefs[m.ref]),
    references: Object.fromEntries(
      Object.entries(readRefs).map(([ref, r]): [string, Citation] => [
        ref,
        { title: r.label, authors: r.authors ?? [], year: r.year ?? '', doi: '', arxiv: '', url: '' },
      ]),
    ),
    onCitation: (marker: CitationMarker) => openReference(readRefs[marker.ref]),
  }
  // The claim's own references are the ones its panel tabs list (those with passages) and the ones it cites.
  const tabbed = referencesOf(claim, draft)
  const ownReferences = [
    ...session.references.filter((r) => tabbed.includes(r.reference_id)),
    ...citedReferences(claim, session.references).filter((r) => !tabbed.includes(r.reference_id)),
  ]
  const otherReferences = session.references.filter((r) => !ownReferences.includes(r))
  const referenceOption = (r: Reference) => (
    <option key={r.reference_id} value={r.reference_id}>
      {referenceName(r, session.markers)}
    </option>
  )
  const referencePicker = session.references.length > 0 && (
    <select
      aria-label="Open reference"
      value={refId ?? ''}
      onChange={(e) => {
        const r = session.references.find((x) => x.reference_id === e.target.value)
        if (r) openReference(r)
      }}
      className="h-8 w-full min-w-0 truncate rounded-lg border border-border-subtle bg-surface px-2 text-xs text-ink"
    >
      {!refId && <option value="">Open reference…</option>}
      {ownReferences.length > 0 && <optgroup label="This claim's references">{ownReferences.map(referenceOption)}</optgroup>}
      {/* Labeled even when it is the only group, so a claim with no reference of its own does not
          offer another claim's references as if they were its own. */}
      {otherReferences.length > 0 && <optgroup label="Other references">{otherReferences.map(referenceOption)}</optgroup>}
    </select>
  )
  const { done, unsaved, ready, total } = progress(claims, drafts, cited, saved)
  const nextUnfinished = nextUnfinishedIndex(claims, drafts, saved, cited, position)
  const viewer = (target: Target, which: Picked['side'], onClose?: () => void) => (
    <PageViewer
      key={target.paper}
      target={target}
      titleOnOwnLine={side}
      onClose={onClose}
      embedded={wide}
      {...(which === 'paper' && citing)}
      className={!wide ? VIEWER_HEIGHT : 'h-full min-h-0'}
      keyboard={false}
      compactQuote={wide}
      zoomKey={`labeler.zoom.${which}`}
      onSelectText={(s) => setPicked({ side: which, file: target.paper, ...s })}
    />
  )

  // `where` is set when the claim was selected in the paper: that text is its sentence.
  const addClaim = (text: string, where: { sentence: string; page: number | null } = { sentence: '', page: null }) => {
    // Not crypto.randomUUID: browsers only have it on https and localhost, and teammates may
    // open the app on plain http at a LAN address. getRandomValues works on both.
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
    const id = `${session.paper_id}#h-${suffix}`
    const added: WorkClaim = { claim_id: id, claim: text, section: '', source: null, candidates: [], origin: 'human_added', ...where }
    setExtra((all) => [...all, added])
    setDrafts((all) => ({ ...all, [id]: { ...emptyDraft(), status: 'accepted' } }))
    setCurrentId(id)
    setFocus(firstFocus(added, session))
    setPicked(null)
  }

  // Text selected in the reference becomes evidence for this claim, the same as one typed in.
  // Adding evidence to an undecided claim keeps it: evidence only belongs to a claim you keep.
  const addEvidence = () => {
    const referenceId = session.references.find((r) => r.file === picked?.file)?.reference_id
    // The Add button is disabled without a picked text in a listed reference, so this is a guard only.
    /* v8 ignore next -- @preserve */
    if (!picked || !referenceId) return
    const p: AddedPassage = { reference_id: referenceId, page: picked.page, passage: picked.text.slice(0, 1500) }
    if (!draft.added.some((a) => a.reference_id === p.reference_id && a.passage === p.passage)) {
      patch({ added: [...draft.added, p], ...(draft.status ? {} : { status: 'accepted' as const }) }, 'Passage added')
      setFocus({ file: picked.file, passage: p.passage, page: p.page, key: `added:${p.reference_id}:${p.passage}` })
    }
    setPicked(null)
  }
  let cannotAdd: string | null = null
  if (draft.status === 'rejected') cannotAdd = 'This claim is rejected. Keep or edit it to add evidence.'
  else if (!session.references.some((r) => r.file === picked?.file)) cannotAdd = 'That paper is not one of this analysis\'s references.'

  // Everything done to one claim, in the order it is done. Wide screens keep it beside the
  // papers, scrolling by itself, so the papers never move while you work.
  // A reference with a passage you called relevant needs a level; the others are optional.
  const grade = (id: string) => {
    const tag = referenceTag(cited.find((r) => r.reference_id === id), session.markers)
    return relevantPassages(claim, draft, id).length > 0 || draft.labels[id]?.evidence ? (
      <LabelForm
        tag={tag}
        title={cited.find((r) => r.reference_id === id)?.label ?? id}
        active={id === refId}
        label={draft.labels[id]}
        others={session.others[`${claim.claim_id}|${id}`] ?? []}
        onChange={(label) =>
          patch({ labels: { ...draft.labels, [id]: label } }, labelChangeWords(tag, draft.labels[id] ?? emptyLabel(), label))
        }
      />
    ) : (
      <p className="text-sm text-ink-muted">Mark a passage relevant to grade this reference</p>
    )
  }

  // Side by side it opens in the top corner of the papers, beside the label panel, so it never
  // covers the claim or the decision, and above the viewer's toolbar (z-30). Stacked, it opens
  // under its button.
  // Shortcuts need a keyboard, so a touch screen does not list them.
  // Hidden rather than unmounted when closed: the guide opened from it lives in its GuideButton.
  const legend = (
    <section
      ref={shortcutsRef}
      id="labeler-shortcuts"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      hidden={!shortcutsOpen}
      className={cn(
        'absolute right-0 z-40 flex w-80 flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-3 text-ui text-ink-muted shadow-lg focus:outline-none pointer-coarse:hidden',
        wide ? 'top-0' : 'top-full mt-2',
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        {SHORTCUT_GROUPS.map(({ title, keys }) => (
          <div key={title} className="flex flex-col gap-1">
            <h4 className="font-medium text-ink">{title}</h4>
            <ul className="flex flex-col gap-1">
              {keys.map(([key, what]) => (
                <li key={key} className="flex items-center gap-1.5">
                  <Kbd hidden={false}>{key}</Kbd> {what}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <GuideButton
        className="border-t border-border-subtle pt-2"
        onOpen={() => setShortcutsOpen(false)}
        onClose={() => shortcutsButtonRef.current?.focus()}
      />
    </section>
  )

  const nextPaper = pool.data ? nextPaperInTopic(pool.data, session.analysis_id) : null
  const claimWording = draft.status === 'edited' && draft.edited.trim() ? draft.edited : claim.claim
  // Outside the scrolling list on a wide screen, and pinned above the save bar on a narrow one,
  // so the claim never sits on top of the passage being judged.
  const claimPin = (className?: string) =>
    draft.status ? (
      <ClaimSticky
        key={claim.claim_id}
        heading={<ClaimHeading claim={claim} position={position + 1} count={claims.length} />}
        text={claimWording} rejected={draft.status === 'rejected'} className={className} />
    ) : null
  const paperDoneView = (
    <div role="status" className="flex flex-col items-start gap-3">
      <h2 className="font-serif text-lg font-semibold text-ink">This paper is labeled</h2>
      <p className="text-sm leading-6 text-ink-muted">Every claim is finished and saved.</p>
      <div className="flex flex-wrap gap-2">
        {nextPaper && onOpenPaper && (
          <Button type="button" onClick={() => onOpenPaper(nextPaper.analysis_id)}>
            Next paper in your topic
          </Button>
        )}
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            Back to papers
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => setPaperDone(false)}>
          Review claims
        </Button>
      </div>
    </div>
  )

  const hasSavedDecision = Boolean(saved[currentId]?.status)
  const changes = changeCount(draft, saved[currentId])
  let clearLabel = 'Clear decision'
  if (hasSavedDecision) clearLabel = changes > 1 ? `Discard ${changes} changes to this claim` : 'Discard changes to this claim'
  // One undo step for the whole claim: Z puts back the decision, verdicts, levels and reasons at once.
  const clearDecision = () => {
    remember(hasSavedDecision ? 'Discard changes' : 'Clear decision', true)
    setDrafts((all) => ({ ...all, [currentId]: saved[currentId] ?? emptyDraft() }))
    setNotice(hasSavedDecision ? 'Changes discarded · Z to undo' : 'Decision cleared · Z to undo')
    // The button goes away with the change, so the focus moves to the decision rather than the page.
    setDecisionTurns((n) => n + 1)
  }
  const judgedCount = Object.keys(draft.cands).length
  // It counts the works the analysis lists for the claim, which may be fewer than a printed range.
  const unread = unresolvedCitations(claim, session)
  const unreadCount = unread.length
  let noPassagesLine: string | undefined
  if (firstFocus(claim, session) === null) {
    noPassagesLine = unreadCount
      ? `No passages: no reference to read (${unreadCount} cited ${unreadCount === 1 ? 'work' : 'works'}).`
      : 'No passages: this claim cites no paper.'
  }

  const panel = (
    <>
      <ClaimDecision
        claim={claim}
        draft={draft}
        position={position + 1}
        count={claims.length}
        pinned={Boolean(draft.status)}
        markers={session.markers}
        editPicks={editPicks}
        decisionTurns={decisionTurns}
        warnReword={saveTried}
        onRewordBlur={() => setSaveTried(true)}
        onChange={(change) => {
          if (change.status === 'edited') setEditPicks((n) => n + 1)
          patch(change, change.status ? DECISION_WORDS[change.status] : '')
        }}
        onClear={draft.status && dirty ? clearDecision : undefined}
        clearLabel={clearLabel}
      />
      {draft.status === 'rejected' && judgedCount > 0 && (
        // Rejecting hides the passage cards; the verdicts stay in the draft and come back with Keep or Edit.
        <p className="text-sm text-ink-muted">
          {judgedCount} {judgedCount === 1 ? 'passage' : 'passages'} judged: hidden while the claim is rejected.
        </p>
      )}
      {deciding && (
        <PassageList
          claim={claim}
          draft={draft}
          references={cited}
          markers={session.markers}
          focus={focus}
          onFocus={setFocus}
          onJudge={(id, status) => {
            // Choosing the same answer again takes it back: a passage may stay unjudged.
            const { [id]: chosen, ...rest } = draft.cands
            const rank = claim.candidates.find((c) => c.cand_id === id)?.rank
            const what = chosen === status ? 'cleared' : status === 'relevant' ? 'relevant' : 'not relevant'
            patch({ cands: chosen === status ? rest : { ...rest, [id]: status } }, `Passage ${rank} ${what}`)
          }}
          onAdd={(p) => {
            patch({ added: [...draft.added, p] }, 'Passage added')
            focusAdded(p)
          }}
          onRemove={(p) => patch({ added: draft.added.filter((a) => a !== p) }, 'Passage removed')}
          search={search}
          onSearchAgain={searchAgain}
          grade={grade}
          empty={noPassagesLine}
          // An extracted claim that cites no paper has nowhere a passage could come from. One that
          // cites works with no PDF can still take a passage pasted in (#824), and a claim added by
          // hand cites nothing, so any reference may hold its evidence.
          canAdd={!(noPassagesLine && !unreadCount && claim.origin !== 'human_added')}
          pasteOnly={Boolean(noPassagesLine && unreadCount)}
          // A blind check keeps the judge out of the label, so no Ask on its passages either (#867).
          onAsk={
            onOpenAsk && !session.blind
              ? (passage) => {
                  setAsked((before) => ({ claimId: claim.claim_id, passage, id: (before?.id ?? 0) + 1 }))
                  onOpenAsk()
                }
              : undefined
          }
        />
      )}
    </>
  )

  // A step on the save bar takes the labeler to where it is done, which may be scrolled out of
  // view or under another reference's tab.
  const goToStep = ({ at, id = '' }: Step) => {
    if (at === 'decision') {
      setFlash({ selector: '#claim-decision', id: noticeCount.current })
      setDecisionTurns((n) => n + 1)
      return
    }
    if (at === 'passage') {
      focusPassage(claim.candidates.find((c) => c.cand_id === id)!)
      setFlash({ selector: `[data-ask-target="${askTarget({ kind: 'passage', id })}"]`, id: noticeCount.current, focus: 'button' })
      return
    }
    // The level form shows under its reference's tab, so open one of that reference's passages
    // first: a retrieved one, else one the labeler added (a reference has a tab only with either).
    if (refId !== id) {
      const passage = claim.candidates.find((c) => c.reference_id === id)
      if (passage) focusPassage(passage)
      else focusAdded(draft.added.find((a) => a.reference_id === id)!)
    }
    setFlash({
      selector: `[data-ask-target="${askTarget({ kind: 'reference', id })}"] [data-level-form]`,
      id: noticeCount.current,
      focus: `[data-${at}] [tabindex="0"]`,
    })
  }

  const saveBar = (className?: string) => (
    <>
    {/* The live region stays mounted, so a screen reader reads each notice as it appears. */}
    <div role="status">
      {notice && (
        <p key={notice.id} className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-ink">
          {notice.text}
        </p>
      )}
    </div>
    <SaveBar
      left={left}
      dirty={dirty}
      saving={save.isPending}
      error={saveAllError ?? (save.error ? `${problem(save.error).title}. ${problem(save.error).hint}` : null)}
      savedRows={savedRows}
      blocked={saveBlocked}
      warn={saveTried}
      hasNext={claim != null && saveNextTarget(claims, drafts, saved, cited, position).kind !== 'stay'}
      onSave={write}
      onStep={(index) => goToStep(steps[index])}
      claimNumber={position + 1}
      unsavedCount={unsaved}
      onSaveAll={() => void saveAll()}
      className={className}
    />
    </>
  )

  // On a blind check the judge must not sway the label, so Review and Ask are replaced (#867).
  const askPanel = session.blind ? (
    <p className="flex items-start gap-2 p-1 text-sm text-ink-muted">
      <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      Review and Ask are off on a blind check. Decide from the paper and its references alone.
    </p>
  ) : claim && (
    <AskPanel
      key={claim.claim_id}
      analysisId={session.analysis_id}
      claim={claim}
      wording={draft.status === 'edited' && draft.edited ? draft.edited : claim.claim}
      references={session.references}
      reviewBlocked={reviewBlocked}
      onPoint={point}
      passage={asked?.passage ?? null}
      askId={asked?.id ?? 0}
      onClearPassage={() => setAsked((before) => before && { ...before, passage: null })}
    />
  )

  const selection = picked && (
    <SelectionBar
      picked={picked}
      blocked={cannotAdd}
      onEvidence={addEvidence}
      onClaimWording={() => {
        patch({ status: 'edited', edited: picked.text }, 'Claim wording from the selection')
        setPicked(null)
      }}
      onNewClaim={() => addClaim(picked.text, { sentence: picked.text, page: picked.page })}
      onClear={() => setPicked(null)}
    />
  )

  const iconButton =
    'flex size-8 items-center justify-center rounded-lg border border-border-subtle text-ink-muted hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent pointer-coarse:size-11'

  const shortcutsButton = (
    // A touch screen has no keyboard, so it gets no list and no button.
    <button
      ref={shortcutsButtonRef}
      type="button"
      aria-expanded={shortcutsOpen}
      aria-controls="labeler-shortcuts"
      aria-keyshortcuts="?"
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      onClick={toggleShortcuts}
      className={cn(iconButton, 'pointer-coarse:hidden', shortcutsOpen && 'border-accent bg-accent-soft text-ink')}
    >
      <Keyboard className="size-4" aria-hidden="true" />
    </button>
  )

  const viewToggle = (
    <Segmented
      label="Which papers to show"
      options={(roomy ? (['side', 'both', 'reference'] as const) : (['both', 'reference'] as const)).map((option) => ({
        value: option,
        label: VIEW_NAMES[option],
        ...(option === 'reference' && !focus?.file && { disabled: true, title: 'This claim has no reference to read' }),
      }))}
      value={shownView}
      onChange={choosePaperView}
    />
  )

  // With no reference open, the pane lists the unread works in full; with one open, the list
  // folds under the picker, so a claim citing both kinds still says which works were not read.
  const unreadList = unread.length > 0 && (
    <details className="text-xs text-ink-muted">
      <summary className="w-fit cursor-pointer font-medium">
        {unread.length} cited {unread.length === 1 ? 'work' : 'works'} could not be read
      </summary>
      <div className="mt-2 max-h-64 overflow-y-auto">
        <UnresolvedList citations={unread} markers={session.markers} />
      </div>
    </details>
  )

  const referencePane = right ? (
    <div className="flex min-h-0 flex-1 flex-col">{viewer(right, 'reference')}</div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {noReference && (
        <p role="note" className="text-xs text-ink-muted">
          No reference opens for this claim, so the paper under review is shown above.
        </p>
      )}
      <UnresolvedReferences citations={unread} markers={session.markers} />
    </div>
  )

  const papers = (
    // The legend sits outside the column that scrolls in Stacked view, so scrolling never cuts off its top.
    <div className="relative mr-3 flex min-h-0 min-w-0 flex-1 flex-col">
      {legend}
      <div ref={papersRef} className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2', both && 'overflow-y-auto')}>
      {selection}
      {/* Above the papers in every view, on its own row: in the toolbar of a half-width viewer it
          shrank to one letter. Side by side, the papers' headers then line up. */}
      {referencePicker}
      {right && unreadList}
      {side && panesNarrow && (
        <p role="note" className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          Too narrow for side by side: Stacked shows larger pages.
          <TextButton onClick={() => choosePaperView('both')} className="text-xs">
            Show Stacked
          </TextButton>
        </p>
      )}
      {/* The paper under review first and the reference second in every view, as they are read:
          left and right side by side, top and bottom stacked. One SplitPane for all three, so
          changing the view only changes the layout and neither PDF opens again. */}
      <SplitPane
        direction={side ? 'horizontal' : 'vertical'}
        hideLeft={!both && !side}
        leftLabel="Paper under review"
        rightLabel="Cited reference"
        separatorLabel="Resize the paper under review and the reference"
        initialRatio={side ? 0.5 : 0.4}
        minRight={side || both ? PDF_MIN_PX : 120}
        minLeft={both ? PDF_MIN_PX : 0}
        storageKey={side ? SIDE_PAPERS_KEY : STACKED_SPLIT_KEY}
        left={viewer(left_, 'paper')}
        right={referencePane}
      />
      </div>
    </div>
  )

  const labelPanel = (
    <div className="ml-3 flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      {paperDone ? (
        <div className="p-4">{paperDoneView}</div>
      ) : (
        <>
          {claimPin()}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* `relative`: an absolute child (a radio group's sr-only name) must anchor inside this
                scroll box. Anchored outside it, it stuck out of the overflow-hidden panel, which
                then scrolled and hid the claim header. */}
            <div ref={panelScrollRef} data-label-panel className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 scrollbar-gutter-stable">
              {panel}
            </div>
          </div>
          <div className="border-t border-border-subtle">{saveBar('border-0')}</div>
        </>
      )}
    </div>
  )

  const controls = (
    <div className="relative ml-auto flex items-center gap-3 lg:ml-0">
      {wide && viewToggle}
      <div>
        {/* Finished counts saved claims only, and drafts are counted beside it, so the save bar
            never calls a claim done while this count does not. Both counts keep their room while
            hidden, so the controls beside them do not move when a draft starts or gets ready. */}
        <p className="mb-1 flex items-center gap-1 whitespace-nowrap text-xs text-ink-muted tabular-nums">
          {done} of {total} claims finished
          <span aria-hidden={unsaved === 0 || undefined} className={cn('text-accent', unsaved === 0 && 'invisible')}>
            · {unsaved} unsaved
            <span aria-hidden={ready === 0 || undefined} className={cn(ready === 0 && 'invisible')}>
              , {ready} ready to save
            </span>
          </span>
        </p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Claims finished" className="h-2 overflow-hidden rounded-sm bg-border-subtle">
          {/* The bar exists only when a claim does, so `total` is at least 1. */}
          {/* v8 ignore start -- @preserve */}
          <div className="h-full bg-supports transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          {/* v8 ignore stop -- @preserve */}
        </div>
      </div>
      <button
        type="button"
        disabled={nextUnfinished == null}
        aria-keyshortcuts="F"
        // F does not skip a claim that is ready to save: it is not finished until it is written down.
        title="The next claim not finished and saved, including one ready to save (F)"
        onClick={() => {
          /* v8 ignore next -- @preserve */
          if (nextUnfinished == null) return
          setPaperDone(false)
          select(claims[nextUnfinished].claim_id)
        }}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle px-2 text-xs whitespace-nowrap text-ink-muted hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 pointer-coarse:h-11"
      >
        Next unfinished
        <Kbd>F</Kbd>
      </button>
      {shortcutsButton}
      {!wide && legend}
    </div>
  )

  // From 1280px the controls go into the top bar and the claim strip has the row below to itself:
  // sharing the bar with the breadcrumb and Ask AI, twenty chips did not fit.
  const header = (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {/* In the top bar the breadcrumb already names the paper, so the title is for screen readers. */}
      <div className={cn('min-w-0 lg:w-52 lg:shrink-0', inBar && 'sr-only')}>
        <h1 title={session.title} className="line-clamp-2 font-serif text-xl font-semibold text-ink lg:line-clamp-1">
          {session.title}
        </h1>
        <p className="text-xs text-ink-muted">Labeling as {session.annotator}</p>
      </div>
      {/* From 1024px the strip shares this row with the title and controls; below, it gets a row of its own. */}
      <ClaimNav
        className="order-last w-full lg:order-0 lg:w-auto lg:min-w-0 lg:flex-1"
        claims={claims}
        drafts={drafts}
        saved={saved}
        references={cited}
        current={currentId}
        onSelect={select}
        onAdd={addClaim}
        adding={addingClaim}
        setAdding={setAdding}
        text={claimText}
        setText={setClaimText}
        noReference={(item) => firstFocus(item, session) === null}
      />
      {!inBar && controls}
    </header>
  )

  return (
    // Fills the AppShell main box on wide screens so only the paper and label panes scroll.
    <div className={cn('flex flex-col gap-2', wide && 'min-h-0 flex-1')}>
      {inBar && <ToolbarActions orInline>{controls}</ToolbarActions>}
      {header}
      {session.blind && (
        <p role="note" className="flex items-center gap-2 text-xs text-ink-muted">
          <EyeOff className="size-3.5 shrink-0 text-accent" aria-hidden />
          <span>
            <span className="font-semibold text-ink">Blind check:</span> someone else labeled this paper. Their labels
            are hidden until you finish, and Review and Ask are off.
          </span>
        </p>
      )}
      {restored && anyDirty && (
        <p role="status" className="text-sm text-ink-muted">
          Unsaved labels from your last visit were kept in this browser. Save them to keep them for good.
        </p>
      )}

      {wide ? (
        <SplitPane
          leftLabel="Paper and reference"
          rightLabel="Label this claim"
          separatorLabel="Resize the papers and the label panel"
          initialRatio={side ? 0.76 : 0.7}
          minRight={(side ? SIDE_PANEL_MIN_PX : PANEL_MIN_PX) + GUTTER_PX}
          storageKey={side ? SIDE_SPLIT_KEY : SPLIT_KEY}
          left={papers}
          right={labelPanel}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setOverlay('paper')} className="min-h-11 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-sm font-medium text-ink hover:border-accent">
              Read the claim in this paper
            </button>
            <button type="button" disabled={!right} onClick={() => setOverlay('reference')} className="min-h-11 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-sm font-medium text-ink hover:border-accent disabled:opacity-50">
              Read the reference
            </button>
          </div>
          {referencePicker}
          {unreadList}
          {overlay === 'paper' && viewer(left_, 'paper', () => setOverlay(null))}
          {overlay === 'reference' && right && viewer(right, 'reference', () => setOverlay(null))}
          {selection}
          {paperDone ? (
            paperDoneView
          ) : (
            <>
              <div className="flex flex-col gap-5">{panel}</div>
              <div className="sticky bottom-0 z-20 flex flex-col gap-2 bg-canvas pt-2">
                {claimPin('rounded-xl border border-border-subtle shadow-sm')}
                {saveBar()}
              </div>
            </>
          )}
        </div>
      )}
      {/* Drawn in the Ask panel's "This claim" view, but kept here with the claim's state. */}
      {askSlot && askPanel && createPortal(askPanel, askSlot)}
      <MotionConfig reducedMotion="user">
        <AiCursor pointing={askSlot && pointing?.claimId === currentId ? pointing.at : null} />
      </MotionConfig>
    </div>
  )
}
