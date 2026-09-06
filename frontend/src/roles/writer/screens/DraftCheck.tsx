/** Writer Draft check — the draft with every citation marked, and a fix panel for the
 * current issue. `onReplaceCitation` hands off to Citation replaced with the new label. */

import { useState } from 'react'

import { Badge } from '../../../components/Badge'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { ErrorState } from '../../../components/ErrorState'
import { LoadingState } from '../../../components/LoadingState'
import { Quote } from '../../../components/Quote'
import { useDraftCheck, useReplaceCitation } from '../../../lib/useWriter'
import type { DraftWord } from '../../../lib/writer'
import { VERDICT_BADGE_TEXT, VERDICT_LEGEND_TEXT } from '../../../lib/writer'
import './DraftCheck.css'

const LEGEND_KINDS = ['supports', 'refutes', 'insufficient'] as const

function DraftParagraph({ words }: { words: DraftWord[] }) {
  return (
    <p className="draft__paragraph">
      {words.map((word, index) =>
        word.mark ? (
          <mark className={`draft__mark draft__mark--${word.mark}`} key={index}>
            <span className="draft__word">{word.text}</span>
          </mark>
        ) : (
          <span className="draft__word" key={index}>
            {word.text}
          </span>
        ),
      )}
    </p>
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
      {draftCheck.isPending && <LoadingState label="Checking your draft…" />}

      {draftCheck.isError && (
        <ErrorState message={(draftCheck.error as Error).message} onRetry={() => window.location.reload()} />
      )}

      {draftCheck.data && (
        <>
          <header className="page-head">
            <div className="page-head__text">
              <h1 className="page-head__title">Check a draft</h1>
              <p className="page-head__meta">
                {draftCheck.data.draft.fileName} · {draftCheck.data.draft.citationsFound} citations found ·{' '}
                {draftCheck.data.draft.issuesRemaining} need work
              </p>
            </div>
            <div className="page-head__actions">
              <Button variant="ghost" icon={{ src: '/icons/icon-download.svg', alt: 'Export icon' }}>
                Export references
              </Button>
              <Button variant="primary" icon={{ src: '/icons/icon-search.svg', alt: 'Search icon' }}>
                Re-check
              </Button>
            </div>
          </header>

          {draftCheck.data.draft.paragraphs.length === 0 ? (
            <EmptyState
              title="Nothing to check yet"
              hint="Paste or upload a draft to see every citation get a verdict."
            />
          ) : (
            <div className="workspace">
              <section className="draft">
                <h2 className="draft__heading">{draftCheck.data.draft.heading}</h2>

                {draftCheck.data.draft.paragraphs.map((words, index) => (
                  <DraftParagraph words={words} key={index} />
                ))}

                <div className="legend">
                  {LEGEND_KINDS.map((kind) => (
                    <div className="legend__item" key={kind}>
                      <span className={`legend__swatch legend__swatch--${kind}`}></span>
                      <span className="legend__label">{VERDICT_LEGEND_TEXT[kind]}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="fix-panel">
                {issues.length === 0 ? (
                  <EmptyState title="No issues left" hint="Every citation in this draft checks out." />
                ) : (
                  (() => {
                    const issue = issues[activeIndex]
                    return (
                      <>
                        <div className="fix-panel__verdict">
                          <Badge variant={issue.verdict}>{VERDICT_BADGE_TEXT[issue.verdict]}</Badge>
                          <p className="fix-panel__citation">{issue.citation?.label}</p>
                        </div>

                        <p className="fix-panel__explanation">{issue.explanation}</p>

                        {issue.quote && (
                          <Quote text={issue.quote} source={`${issue.quoteLocation} · show in the paper`} sourceAsLink />
                        )}

                        {issue.suggestion && (
                          <>
                            <p className="fix-panel__subtitle">Suggested fix</p>
                            <div className="fix-panel__suggestion">
                              <p className="fix-panel__suggestion-label">Cite the paper that says it:</p>
                              <div className="fix-panel__match">
                                <img className="fix-panel__match-icon" src="/icons/icon-sparkles.svg" alt="Sparkles icon" />
                                <p className="fix-panel__match-text">
                                  {issue.suggestion.citation}. {issue.suggestion.title} — {issue.suggestion.location},
                                  similarity {issue.suggestion.similarity.toFixed(2)}
                                </p>
                              </div>
                              <div className="fix-panel__buttons">
                                <Button
                                  variant="primary"
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

                        <div className="fix-panel__footer">
                          <p className="fix-panel__progress">
                            {activeIndex + 1} of {issues.length} issues
                          </p>
                          <Button
                            variant="ghost"
                            icon={{ src: '/icons/icon-chevron-right.svg', alt: 'Chevron right icon' }}
                            onClick={() => setIssueIndex((n) => Math.min(n + 1, issues.length - 1))}
                          >
                            Next issue
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
