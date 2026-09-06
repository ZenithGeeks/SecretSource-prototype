/** Writer Find a source — search the library (and open access) for a source that backs
 * a sentence. `onCiteBestMatch` hands off to Citation replaced with the cited label. */

import { useState } from 'react'

import { Badge } from '../../../components/Badge'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { ErrorState } from '../../../components/ErrorState'
import { Input } from '../../../components/Input'
import { LoadingState } from '../../../components/LoadingState'
import { Quote } from '../../../components/Quote'
import { Toggle } from '../../../components/Toggle'
import { useSourceSearch } from '../../../lib/useWriter'
import { VERDICT_BADGE_TEXT } from '../../../lib/writer'
import './FindASource.css'

const INITIAL_QUERY = 'compressing token-level embeddings makes the index 6–10× smaller'

const VERDICT_VERB: Record<'refutes' | 'insufficient', string> = {
  refutes: 'contradicts',
  insufficient: 'is silent on',
}

function sourceMeta(result: { inLibrary: boolean; openAccess: boolean; isCurrentCitation: boolean }) {
  const parts = [result.inLibrary ? 'in library' : 'open access · not in library']
  if (result.isCurrentCitation) parts.push('your current citation')
  return `· ${parts.join(' · ')}`
}

export function FindASource({ onCiteBestMatch }: { onCiteBestMatch: (citationLabel: string) => void }) {
  const [query, setQuery] = useState(INITIAL_QUERY)
  const [submittedQuery, setSubmittedQuery] = useState(INITIAL_QUERY)
  const search = useSourceSearch(submittedQuery)
  const [libraryOnly, setLibraryOnly] = useState(true)
  const [openAccess, setOpenAccess] = useState(true)
  const [citedByLibrary, setCitedByLibrary] = useState(false)

  return (
    <>
      <h1 className="main__title">Find the source that actually says it</h1>

      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault()
          setSubmittedQuery(query)
        }}
      >
        <Input
          aria-label="Search for a source"
          placeholder="compressing token-level embeddings makes the index 6–10× smaller"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="primary" type="submit" icon={{ src: '/icons/icon-search.svg', alt: 'Search icon' }}>
          Search
        </Button>
      </form>

      {search.data && (
        <section className="filters">
          <p className="filters__label">Search in</p>
          <Toggle active={libraryOnly} onToggle={() => setLibraryOnly((v) => !v)}>
            My library ({search.data.libraryCount})
          </Toggle>
          <Toggle active={openAccess} onToggle={() => setOpenAccess((v) => !v)}>
            Open access
          </Toggle>
          <Toggle active={citedByLibrary} onToggle={() => setCitedByLibrary((v) => !v)}>
            Cited by my library
          </Toggle>
          <p className="filters__separator">·</p>
          <p className="filters__note">Matching by meaning of passages, not keywords</p>
        </section>
      )}

      {search.isPending && <LoadingState label="Searching your library…" />}

      {search.isError && (
        <ErrorState message={(search.error as Error).message} onRetry={() => search.refetch()} />
      )}

      {search.data && (
        <>
          <section className="hint">
            <img className="hint__icon" src="/icons/icon-sparkles.svg" alt="Sparkles icon" />
            <p className="hint__text">
              Your current citation for this sentence is {search.data.currentCitation.label}, which{' '}
              {VERDICT_VERB[search.data.currentCitationVerdict]} it. Best match below says it directly.
            </p>
          </section>

          {search.data.results.length === 0 ? (
            <EmptyState title="No sources found" hint="Try a different phrasing, or search open access too." />
          ) : (
            <section className="results">
              {search.data.results.map((result) => (
                <article className={`result${result.isBestMatch ? ' result--best' : ''}`} key={result.id}>
                  <div className="result__meta">
                    <Badge variant={result.verdict}>{VERDICT_BADGE_TEXT[result.verdict]}</Badge>
                    <p className="result__similarity">similarity {result.similarity.toFixed(2)}</p>
                    <p className="result__source">{sourceMeta(result)}</p>
                    {result.isBestMatch && <span className="result__tag">best match</span>}
                  </div>

                  <p className="result__title">
                    {result.citation}. {result.title}
                  </p>

                  <Quote
                    text={result.quote}
                    source={`${result.location} · show in the paper`}
                    sourceAsLink
                    linkModifier={result.isBestMatch}
                    muted={result.isCurrentCitation}
                  />

                  <div className="result__actions">
                    <Button
                      variant={result.isBestMatch ? 'primary' : 'ghost'}
                      icon={{ src: result.isBestMatch ? '/icons/icon-copy-white.svg' : '/icons/icon-copy.svg', alt: 'Cite icon' }}
                      onClick={result.isBestMatch ? () => onCiteBestMatch(result.citation) : undefined}
                    >
                      Cite this
                    </Button>
                    {!result.inLibrary && (
                      <Button variant="ghost" icon={{ src: '/icons/icon-download.svg', alt: 'Add to library icon' }}>
                        Add to library
                      </Button>
                    )}
                    <Button variant="ghost" icon={{ src: '/icons/icon-copy.svg', alt: 'Copy icon' }}>
                      BibTeX
                    </Button>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}
