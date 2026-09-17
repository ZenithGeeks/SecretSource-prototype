/** Writer Draft check — the draft with every citation marked, a fix panel for the selected
 * issue, and (once a citation has just been replaced) the 08b "citation replaced" toast — a
 * state of this screen, not a separate one, driven by the store's pending replacement.
 * Verdict chips filter which issues the side panel shows (`?filter=`); clicking a marked
 * claim in the text selects it (`?claim=`); `?draft=` picks which draft to check. */

import { CheckCircle2, ChevronRight, Download, Loader2, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, Card, Empty, StandingBadge } from '../../../components/ui'
import { useDraftCheck, useWriterActions } from '../../../lib/useWriter'
import { VERDICT_LEGEND_TEXT } from '../../../lib/writer'
import type { DraftWord, Issue, VerdictKind } from '../../../lib/writer'
import { cn } from '../../../lib/utils'

const LEGEND_KINDS: VerdictKind[] = ['supports', 'refutes', 'insufficient']

const MARK_STYLES: Record<VerdictKind, string> = {
  supports: 'bg-supports-soft border-supports',
  refutes: 'bg-refutes-soft border-refutes',
  insufficient: 'bg-insufficient-soft border-insufficient',
}

const SWATCH_STYLES: Record<VerdictKind, string> = {
  supports: 'bg-supports',
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
}

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const draftId = params.get('draft') ?? undefined
  const claimId = params.get('claim') ?? undefined
  const filterRaw = params.get('filter')
  const filterKinds: VerdictKind[] = filterRaw
    ? filterRaw.split(',').filter((k): k is VerdictKind => (LEGEND_KINDS as string[]).includes(k))
    : ['refutes', 'insufficient']
  return { draftId, claimId, filterKinds }
}

/** Writes claim/filter into the URL without touching `screen`, `draft`, or other params. */
function writeParams(next: { claimId?: string; filterKinds: VerdictKind[] }) {
  const params = new URLSearchParams(window.location.search)
  if (next.claimId) params.set('claim', next.claimId)
  else params.delete('claim')
  if (next.filterKinds.length > 0) params.set('filter', next.filterKinds.join(','))
  else params.delete('filter')
  window.history.replaceState(null, '', `?${params.toString()}`)
}

function DraftParagraph({ words, onSelectClaim }: { words: DraftWord[]; onSelectClaim: (claimId: string) => void }) {
  return (
    <p className="flex flex-wrap items-start gap-x-1.5 gap-y-1.5">
      {words.map((word, index) => {
        if (!word.mark) {
          return (
            <span key={index} className="text-ink">
              {word.text}
            </span>
          )
        }
        if (word.claimId) {
          const claimId = word.claimId
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelectClaim(claimId)}
              className={cn('rounded-none border-b-2 px-0.5 text-ink', MARK_STYLES[word.mark])}
            >
              {word.text}
            </button>
          )
        }
        return (
          <mark key={index} className={cn('rounded-none border-b-2 px-0.5 text-ink', MARK_STYLES[word.mark])}>
            {word.text}
          </mark>
        )
      })}
    </p>
  )
}

export function DraftCheck({ onGoToFindSource }: { onGoToFindSource: (claimId: string) => void }) {
  const initial = readParams()
  const [claimId, setClaimIdState] = useState(initial.claimId)
  const [filterKinds, setFilterKindsState] = useState<VerdictKind[]>(initial.filterKinds)
  const [isRechecking, setIsRechecking] = useState(false)
  const draftCheck = useDraftCheck(initial.draftId, filterKinds)
  const actions = useWriterActions()
  const recheckTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(recheckTimer.current), [])

  const setClaimId = (id?: string) => {
    setClaimIdState(id)
    writeParams({ claimId: id, filterKinds })
  }

  const toggleFilterKind = (kind: VerdictKind) => {
    const next = filterKinds.includes(kind) ? filterKinds.filter((k) => k !== kind) : [...filterKinds, kind]
    setFilterKindsState(next)
    writeParams({ claimId, filterKinds: next })
  }

  const issues = draftCheck.data?.issues ?? []
  // No claim requested: default to the first issue. A claim requested but not found among the
  // current (filtered) issues stays unselected rather than silently falling back to whichever
  // issue happens to be at index 0 — the panel below tells the user nothing matched instead.
  const activeIndex = claimId === undefined ? (issues.length > 0 ? 0 : -1) : issues.findIndex((i) => i.id === claimId)
  const activeIssue: Issue | undefined = activeIndex >= 0 ? issues[activeIndex] : undefined

  const dismissPendingToast = () => {
    if (draftCheck.data?.pendingReplacement) actions.dismissReplacement(draftCheck.data.pendingReplacement.claimId)
  }

  const goToIssue = (index: number) => {
    const next = issues[Math.min(Math.max(index, 0), issues.length - 1)]
    // Only dismiss when the selection actually moves — index clamps at the ends (e.g. "Next
    // issue" on the last issue), and a no-op click shouldn't kill the only record of a pending
    // replacement (Undo stops working once dismissReplacement deletes it).
    if (next && next.id !== activeIssue?.id) dismissPendingToast()
    if (next) setClaimId(next.id)
  }

  // Exports the currently filtered issues, not the draft's full reference list (uncited and
  // supports-verdict claims are never included) — "Export issues" says so; don't relabel this
  // "Export references" without also changing what it exports.
  const exportCsv = () => {
    if (!draftCheck.data) return
    const rows = [
      ['claim', 'citation', 'verdict'],
      ...issues.map((issue) => [issue.text, issue.citation?.label ?? '', issue.verdict]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draftCheck.data.draft.fileName.replace(/\.\w+$/, '')}-verdicts.csv`
    // Append before clicking and revoke on a later tick — some browsers (Firefox, Safari) treat
    // a detached anchor whose object URL is revoked on the same tick as click() as a cancelled
    // download.
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const recheck = () => {
    if (!activeIssue) return
    // Re-check never changes which claim is selected, so it has no business dismissing a
    // pending replacement toast — that toast may belong to an entirely different claim.
    setIsRechecking(true)
    recheckTimer.current = setTimeout(() => {
      actions.recheckClaim(activeIssue.id)
      setIsRechecking(false)
    }, 700)
  }

  if (draftCheck.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Checking your draft…
      </p>
    )
  }

  if (draftCheck.isError) {
    return (
      <Card className="border-refutes text-refutes">
        Could not check this draft: {(draftCheck.error as Error).message}
      </Card>
    )
  }

  if (!draftCheck.data) return null

  return (
    <div className="relative flex flex-1 flex-col gap-5">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">Check a draft</h1>
          <p className="text-sm text-ink-muted">
            {draftCheck.data.draft.fileName} · {draftCheck.data.draft.citationsFound} citations found ·{' '}
            {draftCheck.data.draft.issuesRemaining} need work
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Button variant="ghost" onClick={exportCsv}>
            <Download className="size-4" />
            Export issues
          </Button>
        </div>
      </header>

      {draftCheck.data.draft.paragraphs.length === 0 ? (
        <Empty title="Nothing to check yet" hint="Paste or upload a draft to see every citation get a verdict." />
      ) : (
        <div className="flex flex-1 items-stretch gap-4">
          <section className="flex flex-1 flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-7">
            <h2 className="font-serif text-lg font-semibold tracking-tight text-ink">
              {draftCheck.data.draft.heading}
            </h2>

            <div className="flex flex-col gap-4">
              {draftCheck.data.draft.paragraphs.map((words, index) => (
                <DraftParagraph words={words} onSelectClaim={setClaimId} key={index} />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3.5">
              {LEGEND_KINDS.map((kind) => {
                const active = filterKinds.includes(kind)
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleFilterKind(kind)}
                    aria-pressed={active}
                    className={cn('flex items-center gap-1.5 rounded px-1 py-0.5', !active && 'opacity-40')}
                  >
                    <span className={cn('h-[3px] w-3.5', SWATCH_STYLES[kind])} />
                    <span className="text-xs text-ink-muted">{VERDICT_LEGEND_TEXT[kind]}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="flex w-[400px] shrink-0 flex-col gap-3.5 rounded-xl border border-border-subtle bg-surface p-5">
            {issues.length === 0 ? (
              <Empty title="No issues left" hint="Every citation in this draft checks out." />
            ) : !activeIssue ? (
              <Empty title="Claim not shown" hint="That claim isn't in the current filter — toggle the chips above to find it." />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StandingBadge standing={activeIssue.verdict} />
                  <p className="text-xs text-ink-muted">{activeIssue.citation?.label}</p>
                  <Button variant="ghost" onClick={recheck} disabled={isRechecking} className="ml-auto shrink-0">
                    {isRechecking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    Re-check
                  </Button>
                </div>

                <p className="text-sm text-ink-muted">{activeIssue.explanation}</p>

                {activeIssue.quote && (
                  <blockquote className="border-l-2 border-accent pl-3 text-sm italic text-ink">
                    {activeIssue.quote}
                    <p className="mt-1 text-xs not-italic text-accent">
                      {activeIssue.quoteLocation} · show in the paper
                    </p>
                  </blockquote>
                )}

                {activeIssue.suggestion && (
                  <>
                    <p className="text-sm font-medium text-ink">Suggested fix</p>
                    <div className="flex w-full flex-col gap-2 rounded-lg bg-canvas p-3">
                      <p className="text-xs text-ink-muted">Cite the paper that says it:</p>
                      <div className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
                        <p className="text-sm text-ink">
                          {activeIssue.suggestion.citation}. {activeIssue.suggestion.title} —{' '}
                          {activeIssue.suggestion.location}, similarity {activeIssue.suggestion.similarity.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => onGoToFindSource(activeIssue.id)}>Replace citation</Button>
                        <Button variant="ghost" onClick={() => goToIssue(activeIndex + 1)}>
                          Keep mine
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex w-full items-center justify-between">
                  <p className="text-xs text-ink-muted">
                    {activeIndex + 1} of {issues.length} issues
                  </p>
                  <Button variant="ghost" onClick={() => goToIssue(activeIndex + 1)}>
                    Next issue
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {draftCheck.data.pendingReplacement && (
        <div
          role="status"
          className="fixed bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-lg"
        >
          <CheckCircle2 className="size-4 shrink-0 text-supports" />
          <p className="text-sm">Citation replaced with {draftCheck.data.pendingReplacement.newCitationLabel}</p>
          <button
            type="button"
            onClick={() => actions.undoReplacement(draftCheck.data!.pendingReplacement!.claimId)}
            className="rounded bg-white/10 px-2.5 py-1 text-xs font-medium"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={dismissPendingToast}
            aria-label="Dismiss"
            className="rounded p-1 text-white/70 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
