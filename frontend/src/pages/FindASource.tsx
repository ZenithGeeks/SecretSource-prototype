import { useNavigate } from 'react-router-dom'

import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Quote } from '../components/Quote'
import { Sidebar } from '../components/Sidebar'
import { searchResults } from '../data/find-source'
import './FindASource.css'

export default function FindASource() {
  const navigate = useNavigate()

  return (
    <div className="app" data-page="find-source">
      <Sidebar roleChange />

      <main className="main">
        <h1 className="main__title">Find the source that actually says it</h1>

        <section className="search">
          <div className="search__field">
            <input
              className="search__input"
              type="text"
              aria-label="Search for a source"
              placeholder="compressing token-level embeddings makes the index 6–10× smaller"
            />
          </div>
          <Button variant="primary" icon={{ src: '/icons/icon-search.svg', alt: 'Search icon' }}>
            Search
          </Button>
        </section>

        <section className="filters">
          <p className="filters__label">Search in</p>
          <button className="filters__chip filters__chip--active" type="button">
            My library (9)
          </button>
          <button className="filters__chip filters__chip--active" type="button">
            Open access
          </button>
          <button className="filters__chip" type="button">
            Cited by my library
          </button>
          <p className="filters__separator">·</p>
          <p className="filters__note">Matching by meaning of passages, not keywords</p>
        </section>

        <section className="hint">
          <img className="hint__icon" src="/icons/icon-sparkles.svg" alt="Sparkles icon" />
          <p className="hint__text">
            Your current citation for this sentence is Khattab &amp; Zaharia (2020), which contradicts it. Best
            match below says it directly.
          </p>
        </section>

        <section className="results">
          {searchResults.map((result) => (
            <article className={`result${result.best ? ' result--best' : ''}`} key={result.title}>
              <div className="result__meta">
                <Badge variant={result.badgeVariant}>{result.badgeVariant.toUpperCase()}</Badge>
                <p className="result__similarity">{result.similarity}</p>
                <p className="result__source">{result.sourceMeta}</p>
                {result.tag && <span className="result__tag">{result.tag}</span>}
              </div>

              <p className="result__title">{result.title}</p>

              <Quote {...result.quote} />

              <div className="result__actions">
                {result.actions.map((action) => (
                  <Button
                    variant={action.variant}
                    icon={action.icon}
                    key={action.label}
                    onClick={action.navigateTo ? () => navigate(action.navigateTo!) : undefined}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
