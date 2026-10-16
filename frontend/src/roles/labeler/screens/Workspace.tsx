/**
 * The labeling workspace: one claim at a time, with the reference it cites and, on request, the
 * paper that makes it.
 *
 * Everything is decided by the person here. The page only shows what the system found (claims,
 * passages) and writes what the person decides. A claim is saved on its own, so a half-labeled
 * paper is never lost and two people can work on different papers at once.
 */

import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { PageViewer, type Target } from '../../../components/PageViewer'
import { Empty, LoadingScreen } from '../../../components/ui'
import { api } from '../../../lib/api'
import { cn } from '../../../lib/utils'
import {
  type AddedPassage,
  buildSave,
  byline,
  displayOrder,
  draftFromSaved,
  emptyDraft,
  emptyLabel,
  labelingApi,
  progress,
  referencesOf,
  relevantPassages,
  remaining,
  sameDraft,
  problem,
  useSaveLabels,
  workClaims,
  type Candidate,
  type Draft,
  type Level,
  type Session,
  type WorkClaim,
  useLabelSession,
} from '../../../lib/labeling'
import { ClaimDecision, Kbd } from '../components/ClaimDecision'
import { ClaimNav } from '../components/ClaimNav'
import { LabelForm } from '../components/LabelForm'
import { PassageList, type Focus } from '../components/PassageList'
import { SaveBar } from '../components/SaveBar'
import { SelectionBar, type Picked } from '../components/SelectionBar'

const VIEWER_HEIGHT = 'h-[60vh]'

const VIEW_KEY = 'labeler.paperView'
type PaperView = 'both' | 'reference'
/** "Reference + this paper" stacks the two PDFs rather than putting them side by side. A two-column paper
 * needs a page about 800px wide to read, and the page content stops at 110rem, so two columns
 * never get more than ~650px each (at 1920, ~450px: text about 5px high). */
const storedView = (): PaperView => {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY)
    if (stored === 'reference' || stored === 'both') return stored
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
  const c = claim.candidates[0]
  if (c) return { file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id }
  const ref = session.references[0]
  return ref ? { file: ref.file, passage: '', page: 1, key: `ref:${ref.reference_id}` } : null
}

export function Workspace({ analysisId, onDirtyChange }: { analysisId: string; onDirtyChange?: (unsaved: boolean) => void }) {
  const query = useLabelSession(analysisId)
  if (query.isLoading) return <LoadingScreen label="Opening the paper's claims…" />
  if (query.error || !query.data)
    return <Empty {...problem(query.error)} />
  return <Body key={analysisId} session={query.data} onDirtyChange={onDirtyChange} />
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


function Body({ session, onDirtyChange }: { session: Session; onDirtyChange?: (unsaved: boolean) => void }) {
  const base = useMemo(() => workClaims(session), [session])
  const [extra, setExtra] = useState<WorkClaim[]>([])
  const listed = useMemo(
    () => [...base, ...extra.filter((e) => !base.some((b) => b.claim_id === e.claim_id))],
    [base, extra],
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(base.map((c) => [c.claim_id, draftFromSaved(c, session.saved)])),
  )
  const [saved, setSaved] = useState(drafts) // each claim as last written, to know what changed
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
  const both = paperView === 'both'
  const save = useSaveLabels(session.analysis_id)

  const go = (id: string) => {
    const next = claims.find((c) => c.claim_id === id)
    setCurrentId(id)
    setFocus(next ? firstFocus(next, session) : null)
    setSavedRows(null)
    setPicked(null)
    save.reset()
  }

  // Moving to another claim keeps the draft of the one being left: it stays marked unsaved until
  // it is saved, and nothing is written that the person did not save.
  const select = (id: string) => {
    if (id === currentId || save.isPending) return
    go(id)
  }

  // Edit starts from the extracted wording, so a small fix is not a full retype.
  const patch = (change: Partial<Draft>) =>
    setDrafts((all) => {
      const before = all[currentId] ?? emptyDraft()
      const start = change.status === 'edited' && !before.edited && claim ? { edited: claim.claim } : {}
      return { ...all, [currentId]: { ...before, ...start, ...change } }
    })

  const dirty = !sameDraft(draft, saved[currentId])
  const anyDirty = Object.keys(drafts).some((id) => !sameDraft(drafts[id], saved[id]))
  const position = claims.findIndex((c) => c.claim_id === currentId)
  const left = claim ? remaining(claim, draft, session.references) : []

  const write = (next: boolean) => {
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
    queryFn: () => api.findInPaper(focus!.file, focus!.passage.slice(0, 300), focus?.page ?? undefined),
    enabled: Boolean(focus?.passage),
    staleTime: Infinity,
    retry: false,
  })

  if (!claim) return <Empty title="No claims in this paper" hint="Extraction found none. Add one by hand below." />

  const left_: Target = {
    paper: session.paper_file,
    label: 'This paper, where the claim is made',
    quote: claim.sentence || claim.claim,
    source: claimSource,
    page: claimSource?.page ?? claim.page ?? 1,
  }
  const shown = focus && session.references.find((r) => r.file === focus.file)
  const right: Target | null = focus && {
    paper: focus.file,
    // "[b47]" matches the marker in the claim's sentence, so the two can be read together.
    label: !shown ? 'Reference' : shown.ref ? `Reference [${shown.ref}]: ${shown.label}` : `Reference: ${shown.label}`,
    detail: shown ? byline(shown) : undefined,
    quote: focus.passage || undefined,
    source: found.data && found.data.page ? found.data : null,
    page: focus.page ?? 1,
    error: found.isError ? 'Could not look up where this passage is.' : undefined,
  }
  const { done, total } = progress(claims, drafts, session.references, saved)
  const refs = referencesOf(claim, draft)
  const viewer = (target: Target, side: Picked['side'], onClose?: () => void) => (
    <PageViewer
      key={target.paper}
      target={target}
      onClose={onClose}
      className={!wide ? VIEWER_HEIGHT : both ? 'h-[75vh] shrink-0' : 'h-full min-h-0'}
      keyboard={false}
      compactQuote={wide}
      zoomKey={`labeler.zoom.${side}`}
      onSelectText={(s) => setPicked({ side, file: target.paper, ...s })}
    />
  )

  // `where` is set when the claim was selected in the paper: that text is its sentence.
  const addClaim = (text: string, where: { sentence: string; page: number | null } = { sentence: '', page: null }) => {
    const id = `${session.paper_id}#h-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
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
    if (!picked || !referenceId) return
    const p: AddedPassage = { reference_id: referenceId, page: picked.page, passage: picked.text.slice(0, 1500) }
    if (!draft.added.some((a) => a.reference_id === p.reference_id && a.passage === p.passage)) {
      patch({ added: [...draft.added, p], ...(draft.status ? {} : { status: 'accepted' as const }) })
      setFocus({ file: picked.file, passage: p.passage, page: p.page, key: `added:${p.reference_id}:${p.passage}` })
    }
    setPicked(null)
  }
  const cannotAdd =
    draft.status === 'rejected'
      ? 'This claim is rejected. Keep or edit it to add evidence.'
      : !session.references.some((r) => r.file === picked?.file)
        ? 'That paper is not one of this analysis\'s references.'
        : null

  // Everything done to one claim, in the order it is done. Wide screens keep it beside the
  // papers, scrolling by itself, so the papers never move while you work.
  // A reference with a passage you called relevant needs a level; the others are optional.
  const grade = (id: string) =>
    relevantPassages(claim, draft, id).length > 0 || draft.labels[id]?.evidence ? (
      <LabelForm
        title={session.references.find((r) => r.reference_id === id)?.label ?? id}
        active={id === refId}
        label={draft.labels[id]}
        others={session.others[`${claim.claim_id}|${id}`] ?? []}
        onChange={(label) => patch({ labels: { ...draft.labels, [id]: label } })}
      />
    ) : (
      <p className="text-sm text-ink-muted">Mark a passage relevant to grade this reference</p>
    )

  const legend = (
    // Shortcuts need a keyboard, so a touch screen does not list them.
    <ul aria-label="Keyboard shortcuts" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted pointer-coarse:hidden">
      {[
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
          references={session.references}
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

  const viewToggle = (
    <div role="group" aria-label="Which papers to show" className="flex rounded-lg border border-border-subtle p-0.5">
      {(['both', 'reference'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={paperView === view}
          onClick={() => choosePaperView(view)}
          className={cn(
            'min-h-11 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent',
            paperView === view ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          {view === 'both' ? 'Reference + this paper' : 'Reference only'}
        </button>
      ))}
    </div>
  )

  return (
    <div className={cn('flex flex-col gap-3', wide && 'h-[calc(100dvh-3rem)]')}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 title={session.title} className="line-clamp-2 font-serif text-xl font-semibold text-ink xl:line-clamp-1">
            {session.title}
          </h1>
          <p className="text-xs text-ink-muted">Labeling as {session.annotator}</p>
        </div>
        <div className="flex items-center gap-4">
          {wide && viewToggle}
          <div className="w-44">
            <p className="mb-1 text-xs text-ink-muted tabular-nums">
              {done} of {total} claims finished
            </p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Claims finished" className="h-2 overflow-hidden rounded bg-border-subtle">
              <div className="h-full bg-supports transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      </header>

      <ClaimNav claims={claims} drafts={drafts} saved={saved} references={session.references} current={currentId} onSelect={select} onAdd={addClaim} />

      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_27rem] gap-4">
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {selection}
            {/* The reference, the paper being judged, on top; the claim's paper below it. */}
            <div className={cn('min-h-0 flex-1 gap-3', both ? 'flex flex-col overflow-y-auto' : 'grid')}>
              {right ? viewer(right, 'reference') : <Empty title="No reference paper" hint="No cited paper was read for this analysis." />}
              {both && viewer(left_, 'paper')}
            </div>
          </div>
          <aside aria-label="Label this claim" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">{panel}</div>
            <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
              {legend}
              {saveBar('border-0 p-0')}
            </div>
          </aside>
        </div>
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
          {overlay === 'paper' && viewer(left_, 'paper', () => setOverlay(null))}
          {overlay === 'reference' && right && viewer(right, 'reference', () => setOverlay(null))}
          {selection}
          <div className="flex flex-col gap-5">{panel}</div>
          {saveBar()}
        </div>
      )}
    </div>
  )
}
