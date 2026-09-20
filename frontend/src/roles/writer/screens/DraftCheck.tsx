/** Writer Draft check — the draft with every citation marked, and a fix panel for the
 * current issue. `onReplaceCitation` hands off to Citation replaced with the new label. */

import { EditorContent, useEditor } from '@tiptap/react'
import TiptapDocument from '@tiptap/extension-document'
import TiptapParagraph from '@tiptap/extension-paragraph'
import TiptapText from '@tiptap/extension-text'
import { ChevronRight, Download, Loader2, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, Empty, StandingBadge } from '../../../components/ui'
import { ClaimVerdict } from '../../../lib/claimVerdictMark'
import { draftToDoc } from '../../../lib/draftToProseMirror'
import { useDraftCheck, useDraftClaims, useReplaceCitation } from '../../../lib/useWriter'
import type { Claim, Draft, VerdictKind } from '../../../lib/writer'
import { cn } from '../../../lib/utils'

const LEGEND: { kind: VerdictKind; label: string }[] = [
  { kind: 'supports', label: 'source backs it' },
  { kind: 'refutes', label: 'source contradicts' },
  { kind: 'insufficient', label: 'source is silent' },
]

const SWATCH_STYLES: Record<VerdictKind, string> = {
  supports: 'bg-supports',
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
}

const DRAFT_EDITOR_EXTENSIONS = [TiptapDocument, TiptapParagraph, TiptapText, ClaimVerdict]

/** Read-only ProseMirror render of a draft (Phase 0, docs/draft-editor-assessment.md) —
 * replaces the old per-word DraftParagraph. No editing, no toolbar; the doc is rebuilt
 * whenever the draft or its claims change. */
function DraftDocument({ draft, claims }: { draft: Draft; claims: Claim[] }) {
  const doc = useMemo(() => draftToDoc(draft, claims), [draft, claims])
  const editor = useEditor({ editable: false, extensions: DRAFT_EDITOR_EXTENSIONS, content: doc }, [doc])
  return <EditorContent editor={editor} className="flex flex-col gap-4 text-ink [&_p]:leading-relaxed" />
}

export function DraftCheck({ onReplaceCitation }: { onReplaceCitation: (citationLabel: string) => void }) {
  const draftCheck = useDraftCheck()
  const claims = useDraftClaims(draftCheck.data?.draft.id)
  const replaceCitation = useReplaceCitation()
  const [issueIndex, setIssueIndex] = useState(0)

  const issues = draftCheck.data?.issues ?? []
  const activeIndex = Math.min(issueIndex, Math.max(issues.length - 1, 0))

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

            <DraftDocument draft={draftCheck.data.draft} claims={claims.data ?? []} />

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
                              {issue.suggestion.citation}. {issue.suggestion.title} — {issue.suggestion.location},
                              similarity {issue.suggestion.similarity.toFixed(2)}
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
  )
}
