import { useNavigate } from 'react-router-dom'

import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Quote } from '../components/Quote'
import { Sidebar } from '../components/Sidebar'
import type { DraftWord } from '../data/draft'
import { draftCheckParagraphs } from '../data/draft'
import './DraftCheck.css'

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

export default function DraftCheck() {
  const navigate = useNavigate()

  return (
    <div className="app" data-page="draft-check">
      <Sidebar />

      <main className="main">
        <header className="page-head">
          <div className="page-head__text">
            <h1 className="page-head__title">Check a draft</h1>
            <p className="page-head__meta">draft-v3.docx · 5 citations found · 2 need work</p>
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

            {draftCheckParagraphs.map((words, index) => (
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
            <div className="fix-panel__verdict">
              <Badge variant="refutes">REFUTES</Badge>
              <p className="fix-panel__citation">Khattab &amp; Zaharia, 2020</p>
            </div>

            <p className="fix-panel__explanation">
              Your sentence says ColBERT (2020) cuts index size 6–10×. That result is from ColBERTv2 (Santhanam
              et al., 2022); the 2020 paper reports the uncompressed 154 GiB index and defers compression.
            </p>

            <Quote
              text="“…we leave compression of the embeddings to future work.”"
              source="colbert.pdf p.7 · show in the paper"
              sourceAsLink
            />

            <p className="fix-panel__subtitle">Suggested fix</p>

            <div className="fix-panel__suggestion">
              <p className="fix-panel__suggestion-label">Cite the paper that says it:</p>
              <div className="fix-panel__match">
                <img className="fix-panel__match-icon" src="/icons/icon-sparkles.svg" alt="Sparkles icon" />
                <p className="fix-panel__match-text">
                  Santhanam et al. (2022). ColBERTv2: Effective and Efficient Retrieval via Lightweight Late
                  Interaction — p.4, similarity 0.91
                </p>
              </div>
              <div className="fix-panel__buttons">
                <Button variant="primary" onClick={() => navigate('/draft-check/replaced')}>
                  Replace citation
                </Button>
                <Button variant="ghost">Keep mine</Button>
              </div>
            </div>

            <div className="fix-panel__footer">
              <p className="fix-panel__progress">1 of 2 issues</p>
              <Button variant="ghost" icon={{ src: '/icons/icon-chevron-right.svg', alt: 'Chevron right icon' }}>
                Next issue
              </Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
