/** Writer Draft check — the draft with every citation marked, and a fix panel for the
 * current issue. `onReplaceCitation` hands off to Citation replaced with the new label. */

import { ChevronRight, Download, Loader2, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty, Input, StandingBadge } from '../../../components/ui'
import { useCheck, useCheckClaim, useDraftCheck, useReplaceCitation } from '../../../lib/useWriter'
import type { DraftWord, VerdictKind } from '../../../lib/writer'
import { cn } from '../../../lib/utils'

const LEGEND: { kind: VerdictKind; label: string }[] = [
  { kind: 'supports', label: 'source backs it' },
  { kind: 'refutes', label: 'source contradicts' },
  { kind: 'insufficient', label: 'source is silent' },
]

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

function DraftParagraph({ words }: { words: DraftWord[] }) {
  return (
    <p className="flex flex-wrap items-start gap-x-1.5 gap-y-1.5">
      {words.map((word, index) =>
        word.mark ? (
          <mark
            key={index}
            className={cn('rounded-none border-b-2 px-0.5 text-ink', MARK_STYLES[word.mark])}
          >
            {word.text}
          </mark>
        ) : (
          <span key={index} className="text-ink">
            {word.text}
          </span>
        ),
      )}
    </p>
  )
}

/** Checks one claim against one citation for real (SCRUM-236) — the gateway's /checks, not
 * the mocked draft below. `source` must be a DOI, arXiv id, or title: the resolvable key
 * sources.py needs, not the author-year label a citation displays (#204 finding B). */
function ClaimCheckCard() {
  const [claim, setClaim] = useState('')
  const [source, setSource] = useState('')
  const [checkId, setCheckId] = useState<string | null>(null)
  const start = useCheckClaim()
  const check = useCheck(checkId)

  return (
    <Card>
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmedClaim = claim.trim()
          const trimmedSource = source.trim()
          if (!trimmedClaim || !trimmedSource) return
          start.mutate({ claim: trimmedClaim, source: trimmedSource }, { onSuccess: ({ id }) => setCheckId(id) })
        }}
      >
        <Input
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          placeholder="Claim sentence"
          aria-label="Claim to check"
        />
        <Input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="DOI, arXiv ID, or paper title"
          aria-label="Citation to check it against"
        />
        <Button
          type="submit"
          disabled={!claim.trim() || !source.trim() || start.isPending || check.data?.status === 'running'}
        >
          {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Check
        </Button>
      </form>

      {start.isError && <p className="mt-3 text-sm text-refutes">{(start.error as Error).message}</p>}

      {check.data?.status === 'running' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Resolving the source and checking the claim…
        </p>
      )}

      {check.data?.status === 'error' && (
        <p className="mt-3 text-sm text-refutes">
          Could not check this claim: {check.data.message || check.data.reason}
        </p>
      )}

      {check.data?.status === 'done' && check.data.verdict && (
        <div className="mt-3 flex flex-col gap-2">
          <StandingBadge standing={check.data.verdict} />
          {check.data.quote && (
            <blockquote className="border-l-2 border-accent pl-3 text-sm italic text-ink">
              {check.data.quote}
            </blockquote>
          )}
          {check.data.reasoning && <p className="text-sm text-ink-muted">{check.data.reasoning}</p>}
        </div>
      )}
    </Card>
  )
}

export function DraftCheck({ onReplaceCitation }: { onReplaceCitation: (citationLabel: string) => void }) {
  const draftCheck = useDraftCheck()
  const replaceCitation = useReplaceCitation()
  const [issueIndex, setIssueIndex] = useState(0)

  const issues = draftCheck.data?.issues ?? []
  const activeIndex = Math.min(issueIndex, Math.max(issues.length - 1, 0))

  return (
    <>
      <ClaimCheckCard />

      {draftCheck.isPending && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Checking your draft…
        </p>
      )}

      {draftCheck.isError && (
        <Card className="border-refutes text-refutes">
          Could not check this draft: {(draftCheck.error as Error).message}
        </Card>
      )}

      {draftCheck.data && (
        <>
          <header className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">Check a draft</h1>
              <p className="text-sm text-ink-muted">
                {draftCheck.data.draft.fileName} · {draftCheck.data.draft.citationsFound} citations found ·{' '}
                {draftCheck.data.draft.issuesRemaining} need work
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Button variant="ghost">
                <Download className="size-4" />
                Export references
              </Button>
              <Button>
                <Search className="size-4" />
                Re-check
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
                    <DraftParagraph words={words} key={index} />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3.5">
                  {LEGEND.map(({ kind, label }) => (
                    <div className="flex items-center gap-1.5" key={kind}>
                      <span className={cn('h-[3px] w-3.5', SWATCH_STYLES[kind])} />
                      <span className="text-xs text-ink-muted">{label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="flex w-[400px] shrink-0 flex-col gap-3.5 rounded-xl border border-border-subtle bg-surface p-5">
                {issues.length === 0 ? (
                  <Empty title="No issues left" hint="Every citation in this draft checks out." />
                ) : (
                  (() => {
                    const issue = issues[activeIndex]
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <StandingBadge standing={issue.verdict} />
                          <p className="text-xs text-ink-muted">{issue.citation?.label}</p>
                        </div>

                        <p className="text-sm text-ink-muted">{issue.explanation}</p>

                        {issue.quote && (
                          <blockquote className="border-l-2 border-accent pl-3 text-sm italic text-ink">
                            {issue.quote}
                            <p className="mt-1 text-xs not-italic text-accent">
                              {issue.quoteLocation} · show in the paper
                            </p>
                          </blockquote>
                        )}

                        {issue.suggestion && (
                          <>
                            <p className="text-sm font-medium text-ink">Suggested fix</p>
                            <div className="flex w-full flex-col gap-2 rounded-lg bg-canvas p-3">
                              <p className="text-xs text-ink-muted">Cite the paper that says it:</p>
                              <div className="flex items-start gap-2">
                                <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
                                <p className="text-sm text-ink">
                                  {issue.suggestion.citation}. {issue.suggestion.title} —{' '}
                                  {issue.suggestion.location}, similarity {issue.suggestion.similarity.toFixed(2)}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  onClick={() => {
                                    const citationLabel = issue.suggestion!.citation
                                    replaceCitation.mutate(issue.id)
                                    onReplaceCitation(citationLabel)
                                  }}
                                >
                                  Replace citation
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => setIssueIndex((n) => Math.min(n + 1, issues.length - 1))}
                                >
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
                          <Button
                            variant="ghost"
                            onClick={() => setIssueIndex((n) => Math.min(n + 1, issues.length - 1))}
                          >
                            Next issue
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      </>
                    )
                  })()
                )}
              </section>
            </div>
          )}
        </>
      )}
    </>
  )
}
