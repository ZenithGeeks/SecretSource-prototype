/**
 * The labeling workspace: the paper and a reference paper side by side, one claim at a time.
 *
 * Everything is decided by the person here. The page only shows what the system found (claims,
 * passages) and writes what the person decides. A claim is saved on its own, so a half-labeled
 * paper is never lost and two people can work on different papers at once.
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { PageViewer, type Target } from '../../../components/PageViewer'
import { Empty, LoadingScreen } from '../../../components/ui'
import { api } from '../../../lib/api'
import {
  type AddedPassage,
  buildSave,
  draftFromSaved,
  emptyDraft,
  emptyLabel,
  progress,
  referencesOf,
  relevantPassages,
  remaining,
  useSaveLabels,
  workClaims,
  type Draft,
  type Level,
  type Session,
  type WorkClaim,
  useLabelSession,
} from '../../../lib/labeling'
import { ClaimDecision } from '../components/ClaimDecision'
import { ClaimNav } from '../components/ClaimNav'
import { LabelForm } from '../components/LabelForm'
import { PassageList, type Focus } from '../components/PassageList'
import { SaveBar } from '../components/SaveBar'
import { SelectionBar, type Picked } from '../components/SelectionBar'

const VIEWER_HEIGHT = 'h-[60vh]'

function useWide() {
  const query = '(min-width: 1280px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setWide(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return wide
}

const firstFocus = (claim: WorkClaim, session: Session): Focus | null => {
  const c = claim.candidates[0]
  if (c) return { file: c.reference_file, passage: c.passage, page: c.page, key: c.cand_id }
  const ref = session.references[0]
  return ref ? { file: ref.file, passage: '', page: 1, key: `ref:${ref.reference_id}` } : null
}

export function Workspace({ analysisId }: { analysisId: string }) {
  const query = useLabelSession(analysisId)
  if (query.isLoading) return <LoadingScreen label="Opening the paper's claims…" />
  if (query.error || !query.data)
    return <Empty title="Could not open this paper for labeling" hint={String(query.error ?? 'No data')} />
  return <Body key={analysisId} session={query.data} />
}

function Body({ session }: { session: Session }) {
  const base = useMemo(() => workClaims(session), [session])
  const [extra, setExtra] = useState<WorkClaim[]>([])
  const claims = useMemo(
    () => [...base, ...extra.filter((e) => !base.some((b) => b.claim_id === e.claim_id))],
    [base, extra],
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(base.map((c) => [c.claim_id, draftFromSaved(c, session.saved)])),
  )
  const [saved, setSaved] = useState(drafts) // each claim as last written, to know what changed
  const [currentId, setCurrentId] = useState(claims[0]?.claim_id ?? '')
  const claim = claims.find((c) => c.claim_id === currentId)
  const draft = (claim && drafts[claim.claim_id]) || emptyDraft()
  const [focus, setFocus] = useState<Focus | null>(() => (claims[0] ? firstFocus(claims[0], session) : null))
  const [overlay, setOverlay] = useState<'paper' | 'reference' | null>(null)
  const [savedRows, setSavedRows] = useState<number | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null) // text just selected in a PDF
  const wide = useWide()
  const save = useSaveLabels(session.analysis_id)

  const select = (id: string) => {
    const next = claims.find((c) => c.claim_id === id)
    setCurrentId(id)
    setFocus(next ? firstFocus(next, session) : null)
    setSavedRows(null)
    setPicked(null)
    save.reset()
  }

  const patch = (change: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [currentId]: { ...(all[currentId] ?? emptyDraft()), ...change } }))

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved[currentId] ?? emptyDraft())
  const left = claim ? remaining(claim, draft) : []

  const write = (next: boolean) => {
    if (!claim) return
    const body = buildSave(claim, draft, saved[claim.claim_id])
    save.mutate(body, {
      onSuccess: (rows) => {
        setSaved((all) => ({ ...all, [claim.claim_id]: structuredClone(draft) }))
        setSavedRows(rows.claims + rows.candidates + rows.labels)
        const index = claims.findIndex((c) => c.claim_id === claim.claim_id)
        if (next && claims[index + 1]) select(claims[index + 1].claim_id)
      },
    })
  }

  // Keys: Ctrl/⌘+S saves; 1-4 label the reference shown on the right.
  const refId = claim && focus ? session.references.find((r) => r.file === focus.file)?.reference_id : undefined
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty && !save.isPending) write(false)
        return
      }
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      if (typing || event.ctrlKey || event.metaKey || event.altKey || !claim || !refId) return
      if (['1', '2', '3', '4'].includes(event.key) && draft.status && draft.status !== 'rejected') {
        const label = draft.labels[refId] ?? emptyLabel()
        patch({ labels: { ...draft.labels, [refId]: { ...label, evidence: Number(event.key) as Level } } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!Object.keys(drafts).some((id) => JSON.stringify(drafts[id]) !== JSON.stringify(saved[id] ?? emptyDraft()))) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [drafts, saved])

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
    label: 'Claim in this paper',
    quote: claim.sentence || claim.claim,
    source: claim.source,
    page: claim.source?.page ?? 1,
  }
  const right: Target | null = focus && {
    paper: focus.file,
    label: session.references.find((r) => r.file === focus.file)?.label ?? 'Reference paper',
    quote: focus.passage || undefined,
    source: found.data && found.data.page ? found.data : null,
    page: focus.page ?? 1,
    error: found.isError ? 'Could not look up where this passage is.' : undefined,
  }
  const { done, total } = progress(claims, drafts)
  const refs = referencesOf(claim, draft)
  const viewer = (target: Target, side: Picked['side'], onClose?: () => void) => (
    <PageViewer
      key={target.paper}
      target={target}
      onClose={onClose}
      className={VIEWER_HEIGHT}
      keyboard={false}
      onSelectText={(s) => setPicked({ side, ...s })}
    />
  )

  const addClaim = (text: string) => {
    const id = `${session.paper_id}#h-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
    const added: WorkClaim = { claim_id: id, claim: text, sentence: '', section: '', source: null, candidates: [], origin: 'human_added' }
    setExtra((all) => [...all, added])
    setDrafts((all) => ({ ...all, [id]: { ...emptyDraft(), status: 'accepted' } }))
    setCurrentId(id)
    setFocus(firstFocus(added, session))
    setPicked(null)
  }

  // Text selected in the reference becomes evidence for this claim, the same as one typed in.
  const addEvidence = () => {
    if (!picked || !refId || !focus) return
    const p: AddedPassage = { reference_id: refId, page: picked.page, passage: picked.text.slice(0, 1500) }
    if (!draft.added.some((a) => a.reference_id === p.reference_id && a.passage === p.passage)) {
      patch({ added: [...draft.added, p] })
      setFocus({ file: focus.file, passage: p.passage, page: p.page, key: `added:${p.reference_id}:${p.passage}` })
    }
    setPicked(null)
  }
  const cannotAdd = !draft.status
    ? 'Decide on the claim first: keep or edit it.'
    : draft.status === 'rejected'
      ? 'This claim is rejected. Keep or edit it to add evidence.'
      : !refId
        ? 'No reference paper is open.'
        : null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-xl font-semibold text-ink">{session.title}</h1>
          <p className="text-xs text-ink-muted">Labeling as {session.annotator}</p>
        </div>
        <div className="w-full max-w-xs">
          <p className="mb-1 text-xs text-ink-muted tabular-nums">
            {done} of {total} claims finished
          </p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Claims finished" className="h-2 overflow-hidden rounded bg-border-subtle">
            <div className="h-full bg-supports transition-[width] duration-200" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <ClaimNav
          claims={claims}
          drafts={drafts}
          current={currentId}
          onSelect={select}
          onAdd={addClaim}
        />

        <div className="flex min-w-0 flex-col gap-4">
          {wide ? (
            <div className="grid grid-cols-2 gap-4">
              {viewer(left_, 'paper')}
              {right ? viewer(right, 'reference') : <Empty title="No reference paper" hint="No cited paper was read for this analysis." />}
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => setOverlay('paper')} className="min-h-11 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-sm font-medium text-ink hover:border-accent">
                Read the claim in the paper
              </button>
              <button type="button" disabled={!right} onClick={() => setOverlay('reference')} className="min-h-11 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-sm font-medium text-ink hover:border-accent disabled:opacity-50">
                Read the reference
              </button>
            </div>
          )}
          {!wide && overlay === 'paper' && viewer(left_, 'paper', () => setOverlay(null))}
          {!wide && overlay === 'reference' && right && viewer(right, 'reference', () => setOverlay(null))}

          {picked && (
            <SelectionBar
              picked={picked}
              blocked={cannotAdd}
              onEvidence={addEvidence}
              onClaimWording={() => {
                patch({ status: 'edited', edited: picked.text })
                setPicked(null)
              }}
              onNewClaim={() => addClaim(picked.text)}
              onClear={() => setPicked(null)}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-5">
              <ClaimDecision claim={claim} draft={draft} onChange={patch} />
              {draft.status && draft.status !== 'rejected' && (
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
                />
              )}
            </div>
            <div className="flex flex-col gap-3">
              {draft.status && draft.status !== 'rejected' && refs.length === 0 && (
                <p className="text-sm text-ink-muted">Nothing to label yet: judge a passage or add one.</p>
              )}
              {draft.status && draft.status !== 'rejected' &&
                refs.map((id) => (
                  <LabelForm
                    key={id}
                    title={session.references.find((r) => r.reference_id === id)?.label ?? id}
                    active={id === refId}
                    label={draft.labels[id]}
                    others={session.others[`${claim.claim_id}|${id}`] ?? []}
                    onChange={(label) => patch({ labels: { ...draft.labels, [id]: label } })}
                  />
                ))}
              {draft.status && draft.status !== 'rejected' && refs.length > 0 && (
                <p className="text-xs text-ink-muted">
                  Press 1–4 to set the level for the reference on the right.
                  {relevantPassages(claim, draft, refId ?? '').length === 0 && refId ? ' Mark one of its passages relevant first.' : ''}
                </p>
              )}
              <SaveBar
                left={left}
                dirty={dirty}
                saving={save.isPending}
                error={save.error ? String(save.error.message) : null}
                savedRows={savedRows}
                hasNext={claims.findIndex((c) => c.claim_id === currentId) < claims.length - 1}
                onSave={write}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
