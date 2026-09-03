import { Link } from 'react-router-dom'

import { Button } from '../components/Button'
import { Sidebar } from '../components/Sidebar'
import type { DraftWord } from '../data/draft'
import { citationReplacedParagraphs } from '../data/draft'
import './CitationReplaced.css'

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
  return (
    <div className="app" data-page="citation-replaced">
      <Sidebar />

      <main className="main">
        <header className="page-head">
          <div className="page-head__text">
            <h1 className="page-head__title">Check a draft</h1>
            <p className="page-head__meta">draft-v3.docx · 5 citations found · 1 needs work</p>
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
            <h2 className="draft__heading">2. Related work</h2>

            {citationReplacedParagraphs.map((words, index) => (
              <DraftParagraph words={words} key={index} />
            ))}

            <div className="legend">
              <div className="legend__item">
                <span className="legend__swatch legend__swatch--supports"></span>
                <span className="legend__label">source backs it</span>
              </div>
              <div className="legend__item">
                <span className="legend__swatch legend__swatch--refutes"></span>
                <span className="legend__label">source contradicts</span>
              </div>
              <div className="legend__item">
                <span className="legend__swatch legend__swatch--insufficient"></span>
                <span className="legend__label">source is silent</span>
              </div>
            </div>
          </section>

          <section className="fix-panel">
            <div className="fix-panel__status">
              <img className="fix-panel__status-icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
              <p className="fix-panel__status-title">1 issue left</p>
              <p className="fix-panel__status-text">
                BEIR (Thakur et al., 2021) is silent on “outperform single-vector retrievers”. Weaken the claim
                or find a source.
              </p>
              <Button variant="primary" icon={{ src: '/icons/icon-chevron-right-white.svg', alt: 'Chevron right icon' }}>
                Next issue
              </Button>
            </div>
          </section>
        </div>
      </main>

      <div className="toast" role="status">
        <img className="toast__icon" src="/icons/icon-check-circle.svg" alt="Check circle icon" />
        <p className="toast__message">Citation replaced with Santhanam et al. (2022)</p>
        <Link className="toast__action" to="/draft-check">
          Undo
        </Link>
        <p className="toast__timer">· 8 s</p>
      </div>
    </div>
  )
}
