/** Writer Citation replaced — the draft with the just-replaced citation, remaining
 * issues, and a toast confirming the swap. `newCitationLabel` is set only right after a
 * replace; visiting this screen otherwise (e.g. a refresh) just shows no toast. */

import { Button } from '../../../components/Button'
import { ErrorState } from '../../../components/ErrorState'
import { LoadingState } from '../../../components/LoadingState'
import { useDraftCheck } from '../../../lib/useWriter'
import type { DraftWord } from '../../../lib/writer'
import { VERDICT_LEGEND_TEXT } from '../../../lib/writer'
import './CitationReplaced.css'

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

export function CitationReplaced({
  newCitationLabel,
  onBackToDraft,
}: {
  newCitationLabel: string | null
  onBackToDraft: () => void
}) {
  const draftCheck = useDraftCheck()

  return (
    <>
      {draftCheck.isPending && <LoadingState label="Loading your draft…" />}

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
                {draftCheck.data.draft.issuesRemaining} need{draftCheck.data.draft.issuesRemaining === 1 ? 's' : ''} work
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
              {draftCheck.data.issues.length > 0 ? (
                <div className="fix-panel__status">
                  <img className="fix-panel__status-icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
                  <p className="fix-panel__status-title">
                    {draftCheck.data.issues.length} issue{draftCheck.data.issues.length === 1 ? '' : 's'} left
                  </p>
                  <p className="fix-panel__status-text">{draftCheck.data.issues[0].explanation}</p>
                  <Button
                    variant="primary"
                    icon={{ src: '/icons/icon-chevron-right-white.svg', alt: 'Chevron right icon' }}
                    onClick={onBackToDraft}
                  >
                    Next issue
                  </Button>
                </div>
              ) : (
                <div className="fix-panel__status">
                  <img className="fix-panel__status-icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
                  <p className="fix-panel__status-title">All caught up</p>
                  <p className="fix-panel__status-text">Every citation in this draft checks out.</p>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {newCitationLabel && (
        <div className="toast" role="status">
          <img className="toast__icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
          <p className="toast__message">Citation replaced with {newCitationLabel}</p>
          <button className="toast__action" type="button" onClick={onBackToDraft}>
            Undo
          </button>
          <p className="toast__timer">· 8 s</p>
        </div>
      )}
    </>
  )
}
