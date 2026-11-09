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

import { PageViewer, type Target } from '../../../components/PageViewer'
import { Empty, LoadingScreen, Segmented } from '../../../components/ui'
import { api, type Citation, type CitationMarker } from '../../../lib/api'
import { cn } from '../../../lib/utils'
import {
  type AddedPassage,
  bestCandidate,
  buildSave,
  byline,
  displayOrder,
  draftFromSaved,
  emptyDraft,
  emptyLabel,
  labelingApi,
  progress,
  readUnsaved,
  referencesOf,
  relevantPassages,
  remaining,
  sameDraft,
  problem,
  useSaveLabels,
  workClaims,
  writeUnsaved,
  type Candidate,
  type Draft,
  type Level,
  type Reference,
  type Session,
  type WorkClaim,
  useLabelSession,
} from '../../../lib/labeling'
import { AiCursor } from '../../../components/AiCursor'
import type { Pointing } from '../../../lib/askCursor'
import { SplitPane } from '../../../components/SplitPane'
import { AskPanel, type AskedPassage } from '../components/AskPanel'
import { ClaimDecision, Kbd } from '../components/ClaimDecision'
import { ClaimNav } from '../components/ClaimNav'
import { LabelForm } from '../components/LabelForm'
import { PassageList, type Focus } from '../components/PassageList'
import { SaveBar } from '../components/SaveBar'
import { SelectionBar, type Picked } from '../components/SelectionBar'

const VIEWER_HEIGHT = 'h-[60vh]'

const VIEW_KEY = 'labeler.paperView'
const SHORTCUTS_KEY = 'labeler.shortcuts' // "hidden" once the person closes the list
const SPLIT_KEY = 'labeler.panelRatio' // the paper's share of the width, kept by SplitPane
// The claim panel never gets narrower than this: it was a fixed 27rem before it could be resized.
const PANEL_MIN_PX = 432
const GUTTER_PX = 12 // the space between the handle and the panel (ml-3), outside the panel's box
const shortcutsShown = () => {
  try {
    return window.localStorage.getItem(SHORTCUTS_KEY) !== 'hidden'
  } catch {
    return true // no stored choice: show them, new labelers need them
  }
}
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

const firstFocus = (claim: WorkClaim, session: Session): Focus | null => {
  // A hand-added claim's passages come from several references at once, so take the best one;
  // an extracted claim's first passage is already the one retrieval ranked first.
  const c = claim.origin === 'human_added' ? bestCandidate(claim, session.references) : claim.candidates[0]
  if (c) return { file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id }
  const ref = session.references[0]
  return ref ? { file: ref.file, passage: '', page: 1, key: `ref:${ref.reference_id}` } : null
}

/** "[b47]" matches the marker in the claim's sentence, so the two can be read together. */
function referenceLabel(reference: Reference | null | undefined): string {
  if (!reference) return 'Reference'
  return reference.ref ? `Reference [${reference.ref}]: ${reference.label}` : `Reference: ${reference.label}`
}

type WorkspaceProps = {
  analysisId: string
  onDirtyChange?: (unsaved: boolean) => void
  /** The Ask panel's "This claim" view (LabelerApp), while it shows; the claim tools are drawn there. */
  askSlot?: HTMLElement | null
  /** Opens the Ask panel on "This claim", for a passage the labeler asks about. */
  onOpenAsk?: () => void
}

export function Workspace({ analysisId, onDirtyChange, askSlot = null, onOpenAsk }: WorkspaceProps) {
  const query = useLabelSession(analysisId)
  if (query.isLoading) return <LoadingScreen label="Opening the paper's claims…" />
  if (query.error || !query.data)
    return <Empty {...problem(query.error)} />
  return <Body key={analysisId} session={query.data} onDirtyChange={onDirtyChange} askSlot={askSlot} onOpenAsk={onOpenAsk} />
}

/** Search the references for each claim added by hand, and add what is found to its passages (#404).
 *
 * The analysis retrieved passages only for the claims it extracted. A hand-added claim is
 * searched when it is opened, once per claim and text. A search for a claim not in view is
 * disabled but still returns what it found before. Passages judged and saved earlier stay in the
 * list even when a new search ranks them out. */
function useAddedClaimSearch(analysisId: string, listed: WorkClaim[], currentId: string) {
  const handAdded = listed.filter((c) => c.origin === 'human_added')
  const searches = useQueries({
    queries: handAdded.map((c) => ({
      queryKey: ['labeling', 'candidates', analysisId, c.claim_id, c.claim],
      queryFn: () => labelingApi.candidates(analysisId, c.claim_id, c.claim),
      enabled: c.claim_id === currentId,
      staleTime: Infinity,
      retry: false,
    })),
  })
  const searchOf = new Map(handAdded.map((c, i) => [c.claim_id, searches[i]]))
  const claims = listed.map((c) => {
    const found = searchOf.get(c.claim_id)?.data?.candidates
    if (!found) return c
    const known = new Set(c.candidates.map((cand) => cand.cand_id))
    return { ...c, candidates: [...c.candidates, ...found.filter((cand) => !known.has(cand.cand_id))] }
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
}: {
  session: Session
  onDirtyChange?: (unsaved: boolean) => void
  askSlot: HTMLElement | null
  onOpenAsk?: () => void
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
  const choosePaperView = (view: PaperView) => {
    setPaperView(view)
    try {
      window.localStorage.setItem(VIEW_KEY, view)
    } catch {
      // the choice just is not remembered
    }
  }
  const wide = useMinWidth(1280)
  const roomy = useMinWidth(SIDE_BY_SIDE_FROM)
  const view: PaperView = paperView === 'side' && !roomy ? 'both' : paperView
  const both = view === 'both'
  const side = view === 'side'
  const save = useSaveLabels(session.analysis_id)

  const go = (id: string) => {
    const next = claims.find((c) => c.claim_id === id)
    setCurrentId(id)
    // Every id that reaches go() is a listed claim, so `next` is set; the check only satisfies the type.
    /* v8 ignore next -- @preserve */
    setFocus(next ? firstFocus(next, session) : null)
    setSavedRows(null)
    setPicked(null)
    save.reset()
  }

  // A claim added by hand has no passages until its search answers, so it opens on the first
  // reference at page 1 (a `ref:` focus). When the passages arrive, open the best one, once per
  // claim. A passage the person opened is kept; reading that first page is not.
  const autoOpened = useRef(new Set<string>())
  useEffect(() => {
    if (claim?.origin !== 'human_added' || autoOpened.current.has(claim.claim_id)) return
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
  const patch = (change: Partial<Draft>) =>
    setDrafts((all) => {
      // patch() runs only while a claim with a draft is on screen; `?? emptyDraft()` and `&& claim` only satisfy the types.
      /* v8 ignore start -- @preserve */
      const before = all[currentId] ?? emptyDraft()
      const start = change.status === 'edited' && !before.edited && claim ? { edited: claim.claim } : {}
      /* v8 ignore stop -- @preserve */
      return { ...all, [currentId]: { ...before, ...start, ...change } }
    })

  const dirty = !sameDraft(draft, saved[currentId])
  const anyDirty = Object.keys(drafts).some((id) => !sameDraft(drafts[id], saved[id]))

  const [shortcutsOpen, setShortcutsOpen] = useState(shortcutsShown)
  const toggleShortcuts = () => {
    setShortcutsOpen(!shortcutsOpen)
    try {
      window.localStorage.setItem(SHORTCUTS_KEY, shortcutsOpen ? 'hidden' : 'shown')
    } catch {
      // the choice just is not remembered
    }
  }
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
  const left = claim ? remaining(claim, draft, cited) : []

  const write = (next: boolean) => {
    // Save is offered, and Ctrl+S allowed, only with a claim on screen.
    /* v8 ignore next -- @preserve */
    if (!claim) return
    const body = buildSave({ ...claim, source: claimSource }, draft, saved[claim.claim_id])
    save.mutate(body, {
      onSuccess: (rows) => {
        setSaved((all) => ({ ...all, [claim.claim_id]: structuredClone(draft) }))
        setSavedRows(rows.claims + rows.candidates + rows.labels)
        const index = claims.findIndex((c) => c.claim_id === claim.claim_id)
        if (next && claims[index + 1]) go(claims[index + 1].claim_id)
      },
    })
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

  // Keys: Ctrl/⌘+S saves; K/E/X decide the claim; R/N judge the focused passage; J/U (or the
  // up and down arrows) move between passages; [ ] (or Shift+left/right) between claims;
  // 1-4 label the reference in view, once it has a relevant passage.
  const refId = claim && focus ? session.references.find((r) => r.file === focus.file)?.reference_id : undefined
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty && !save.isPending) write(false)
        return
      }
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
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
      // A handled letter must not also be typed: E opens the edit box, which takes the focus.
      if (['k', 'e', 'x', 'r', 'n', '1', '2', '3', '4'].includes(key)) event.preventDefault()
      if (key === 'k') patch({ status: 'accepted' })
      else if (key === 'e') patch({ status: 'edited' })
      else if (key === 'x') patch({ status: 'rejected' })
      else if (key === 'r' || key === 'n') {
        const current = ordered.find((c) => c.cand_id === focus?.key)
        if (!deciding || !current) return
        const cands = { ...draft.cands, [current.cand_id]: key === 'r' ? ('relevant' as const) : ('rejected' as const) }
        patch({ cands })
        const at = ordered.indexOf(current)
        const next = [...ordered.slice(at + 1), ...ordered.slice(0, at)].find((c) => !cands[c.cand_id])
        if (next) focusPassage(next)
      } else if (key === 'j' || key === 'ArrowDown') stepPassage(1)
      else if (key === 'u' || key === 'ArrowUp') stepPassage(-1)
      else if (key === ']' || (key === 'ArrowRight' && event.shiftKey)) stepClaim(1)
      else if (key === '[' || (key === 'ArrowLeft' && event.shiftKey)) stepClaim(-1)
      else if (['1', '2', '3', '4'].includes(key) && deciding && refId && relevantPassages(claim, draft, refId).length > 0) {
        const label = draft.labels[refId] ?? emptyLabel()
        patch({ labels: { ...draft.labels, [refId]: { ...label, evidence: Number(key) as Level } } })
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
        label: referenceLabel(shown),
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
  const referencePicker = session.references.length > 0 && (
    <label className="flex min-w-0 items-center gap-2 text-xs text-ink-muted">
      Open reference
      <select
        value={refId ?? ''}
        onChange={(e) => {
          const r = session.references.find((x) => x.reference_id === e.target.value)
          if (r) openReference(r)
        }}
        className="min-h-9 min-w-0 flex-1 truncate rounded-lg border border-border-subtle bg-surface px-2 text-sm text-ink"
      >
        {!refId && <option value="">Choose a reference</option>}
        {session.references.map((r) => (
          <option key={r.reference_id} value={r.reference_id}>
            {r.ref ? `[${r.ref}] ` : ''}
            {r.label}
          </option>
        ))}
      </select>
    </label>
  )
  const { done, total } = progress(claims, drafts, cited, saved)
  const refs = referencesOf(claim, draft)
  const viewer = (target: Target, side: Picked['side'], onClose?: () => void) => (
    <PageViewer
      key={target.paper}
      target={target}
      onClose={onClose}
      {...(side === 'paper' && citing)}
      className={!wide ? VIEWER_HEIGHT : both ? 'h-[75vh] shrink-0' : 'h-full min-h-0'}
      keyboard={false}
      compactQuote={wide}
      zoomKey={`labeler.zoom.${side}`}
      onSelectText={(s) => setPicked({ side, file: target.paper, ...s })}
    />
  )

  // `where` is set when the claim was selected in the paper: that text is its sentence.
  const addClaim = (text: string, where: { sentence: string; page: number | null } = { sentence: '', page: null }) => {
    // Not crypto.randomUUID: browsers only have it on https and localhost, and teammates may
    // open the app on plain http at a Tailscale or LAN address. getRandomValues works on both.
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
      patch({ added: [...draft.added, p], ...(draft.status ? {} : { status: 'accepted' as const }) })
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
  const grade = (id: string) =>
    relevantPassages(claim, draft, id).length > 0 || draft.labels[id]?.evidence ? (
      <LabelForm
        title={cited.find((r) => r.reference_id === id)?.label ?? id}
        active={id === refId}
        label={draft.labels[id]}
        others={session.others[`${claim.claim_id}|${id}`] ?? []}
        onChange={(label) => patch({ labels: { ...draft.labels, [id]: label } })}
      />
    ) : (
      <p className="text-sm text-ink-muted">Mark a passage relevant to grade this reference</p>
    )

  const legend = shortcutsOpen && (
    // Shortcuts need a keyboard, so a touch screen does not list them.
    <ul id="labeler-shortcuts" aria-label="Keyboard shortcuts" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted pointer-coarse:hidden">
      {[
        ['?', 'hide this list'],
        ['K', 'keep'],
        ['E', 'edit'],
        ['X', 'reject'],
        ['R', 'relevant'],
        ['N', 'not relevant'],
        ['J', 'next passage'],
        ['U', 'previous passage'],
        [']', 'next claim'],
        ['[', 'previous claim'],
        ['1–4', 'level'],
        ['Ctrl/⌘+S', 'save'],
      ].map(([keys, what]) => (
        <li key={keys} className="flex items-center gap-1">
          <Kbd hidden={false}>{keys}</Kbd> {what}
        </li>
      ))}
    </ul>
  )

  const panel = (
    <>
      <ClaimDecision claim={claim} draft={draft} position={position + 1} count={claims.length} onChange={patch} />
      {deciding && (
        <PassageList
          claim={claim}
          draft={draft}
          references={cited}
          focus={focus}
          onFocus={setFocus}
          onJudge={(id, status) => patch({ cands: { ...draft.cands, [id]: status } })}
          onAdd={(p) => {
            patch({ added: [...draft.added, p] })
            const file = session.references.find((r) => r.reference_id === p.reference_id)?.file ?? ''
            setFocus({ file, passage: p.passage, page: p.page, key: `added:${p.reference_id}:${p.passage}` })
          }}
          onRemove={(p) => patch({ added: draft.added.filter((a) => a !== p) })}
          search={search}
          onSearchAgain={searchAgain}
          grade={grade}
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
      {deciding && refs.length === 0 && <p className="text-sm text-ink-muted">Nothing to label yet: judge a passage or add one.</p>}
      {!wide && legend}
    </>
  )

  const saveBar = (className?: string) => (
    <SaveBar
      left={left}
      dirty={dirty}
      saving={save.isPending}
      error={save.error ? `${problem(save.error).title}. ${problem(save.error).hint}` : null}
      savedRows={savedRows}
      hasNext={position < claims.length - 1}
      onSave={write}
      className={className}
    />
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
        patch({ status: 'edited', edited: picked.text })
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
      }))}
      value={view}
      onChange={choosePaperView}
    />
  )

  const papers = (
    <div className="mr-3 flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {referencePicker}
      {selection}
      {/* Side by side: the paper under review left, the reference right, as they are read.
          Stacked: the reference on top, since it is the paper being judged. */}
      <div className={cn('min-h-0 flex-1 gap-3', both ? 'flex flex-col overflow-y-auto' : side ? 'grid grid-cols-2' : 'grid')}>
        {side && viewer(left_, 'paper')}
        {right ? viewer(right, 'reference') : <Empty title="No reference paper" hint="No cited paper was read for this analysis." />}
        {both && viewer(left_, 'paper')}
      </div>
    </div>
  )

  const labelPanel = (
    <div className="ml-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">{panel}</div>
      <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
        {legend}
        {saveBar('border-0 p-0')}
      </div>
    </div>
  )

  return (
    // The window less the shell's padding and its 52px toolbar.
    <div className={cn('flex flex-col gap-3', wide && 'h-[calc(100dvh-3rem-52px)]')}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 xl:w-52 xl:shrink-0">
          <h1 title={session.title} className="line-clamp-2 font-serif text-xl font-semibold text-ink xl:line-clamp-1">
            {session.title}
          </h1>
          <p className="text-xs text-ink-muted">Labeling as {session.annotator}</p>
        </div>
        {/* On a wide screen the strip shares this row; below it, the strip gets a row of its own. */}
        <ClaimNav
          className="order-last w-full xl:order-none xl:w-auto xl:min-w-0 xl:flex-1"
          claims={claims}
          drafts={drafts}
          saved={saved}
          references={cited}
          current={currentId}
          onSelect={select}
          onAdd={addClaim}
        />
        <div className="ml-auto flex items-center gap-3 xl:ml-0">
          {wide && viewToggle}
          <div className="w-36">
            <p className="mb-1 whitespace-nowrap text-xs text-ink-muted tabular-nums">
              {done} of {total} claims finished
            </p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Claims finished" className="h-2 overflow-hidden rounded bg-border-subtle">
              {/* The bar exists only when a claim does, so `total` is at least 1. */}
              {/* v8 ignore start -- @preserve */}
              <div className="h-full bg-supports transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              {/* v8 ignore stop -- @preserve */}
            </div>
          </div>
          {shortcutsButton}
        </div>
      </header>
      {session.blind && (
        <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5">
          <EyeOff className="size-5 shrink-0 text-accent" aria-hidden />
          <p className="text-sm font-semibold text-ink">Blind check</p>
          <p className="min-w-0 flex-1 text-sm text-ink-muted">
            Someone else labeled this paper. Their labels are hidden, and Review and Ask are off, so label it on your own.
          </p>
        </div>
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
          initialRatio={0.7}
          minRight={PANEL_MIN_PX + GUTTER_PX}
          storageKey={SPLIT_KEY}
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
          {overlay === 'paper' && viewer(left_, 'paper', () => setOverlay(null))}
          {overlay === 'reference' && right && viewer(right, 'reference', () => setOverlay(null))}
          {selection}
          <div className="flex flex-col gap-5">{panel}</div>
          {saveBar()}
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
