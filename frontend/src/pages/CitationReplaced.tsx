import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Button } from '../components/Button'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { Sidebar } from '../components/Sidebar'
import { useDraftCheck } from '../hooks'
import type { DraftWord } from '../types'
import { VERDICT_LEGEND_TEXT } from '../types'
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

export default function CitationReplaced() {
  const navigate = useNavigate()
  const location = useLocation()
  const { state } = useDraftCheck('d1')
  const newCitationLabel = (location.state as { newCitationLabel?: string } | null)?.newCitationLabel

  return (
    <div className="app" data-page="citation-replaced">
      <Sidebar />

      <main className="main">
        {state.status === 'loading' && <LoadingState label="Loading your draft…" />}

        {state.status === 'error' && (
          <ErrorState message={state.error.message} onRetry={() => window.location.reload()} />
        )}

        {state.status === 'loaded' && (
          <>
            <header className="page-head">
              <div className="page-head__text">
                <h1 className="page-head__title">Check a draft</h1>
                <p className="page-head__meta">
                  {state.data.draft.fileName} · {state.data.draft.citationsFound} citations found ·{' '}
                  {state.data.draft.issuesRemaining} need{state.data.draft.issuesRemaining === 1 ? 's' : ''} work
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
                <h2 className="draft__heading">{state.data.draft.heading}</h2>

                {state.data.draft.paragraphs.map((words, index) => (
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
                {state.data.issues.length > 0 ? (
                  <div className="fix-panel__status">
                    <img className="fix-panel__status-icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
                    <p className="fix-panel__status-title">
                      {state.data.issues.length} issue{state.data.issues.length === 1 ? '' : 's'} left
                    </p>
                    <p className="fix-panel__status-text">{state.data.issues[0].explanation}</p>
                    <Button
                      variant="primary"
                      icon={{ src: '/icons/icon-chevron-right-white.svg', alt: 'Chevron right icon' }}
                      onClick={() => navigate('/draft-check')}
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
      </main>

      {newCitationLabel && (
        <div className="toast" role="status">
          <img className="toast__icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
          <p className="toast__message">Citation replaced with {newCitationLabel}</p>
          <Link className="toast__action" to="/draft-check">
            Undo
          </Link>
          <p className="toast__timer">· 8 s</p>
        </div>
      )}
    </div>
  )
}
