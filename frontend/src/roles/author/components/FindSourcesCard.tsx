/**
 * "Find sources" on Check a draft: a search over Semantic Scholar and the user's own library
 * for a claim. The box starts on the selected issue's sentence (the parent keys the card by
 * the issue), so the suggested fixes show before anything is typed; the top results are
 * verified against that sentence on their own, the rest on request. A result can replace
 * the selected issue's citation ("Insert \cite"), have its BibTeX copied, or be saved to
 * the library.
 */

import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Card, Empty, Input } from '../../../components/ui'
import { errorMessage } from '../../../lib/author'
import { useAuthorSearch, useSavedSources } from '../../../lib/useAuthor'
import { useDebounced } from '../../../lib/useDebounced'
import type { Citation, SavedSource, SearchResult, Verification } from '../../../types/draftCheck'
import { citedBy, FIND_SOURCES_INPUT_ID } from '../labels'
import { AUTO_VERIFY, copiedMessage, copyText, savedMatch } from '../searchHelpers'
import { CardHead } from './CardHead'
import { VerifiedBadge } from './VerifiedBadge'

export function ResultRow({
  result,
  claim,
  auto,
  saved,
  onInsert,
  onCopied,
  onSave,
  insertLabel = 'Insert \\cite',
}: {
  result: SearchResult
  claim: string
  auto: boolean
  saved: SavedSource | undefined
  onInsert: (result: SearchResult, verification: Verification | undefined) => void
  onCopied: (message: string) => void
  onSave: (result: SearchResult, verification: Verification | undefined) => void
  insertLabel?: string
}) {
  const [verification, setVerification] = useState<Verification>()
  const meta = [
    result.authors,
    [result.venue, result.year].filter(Boolean).join(' '),
    result.citedBy !== null ? `cited ${citedBy(result.citedBy)}` : null,
    result.openAccess ? 'open access' : null,
    result.inLibrary ? `in ${result.bibName ?? 'library'}` : null,
    `similarity ${result.similarity.toFixed(2)}`,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-[3px] border-b border-border-subtle py-2">
      <div className="flex flex-wrap items-center gap-2">
        {claim && <VerifiedBadge claim={claim} identifier={result.identifier} auto={auto} onVerified={setVerification} />}
        <p className="text-[13px] font-medium text-ink">{result.title}</p>
      </div>
      <p className="text-xs text-ink-muted">{meta.join(' · ')}</p>
      {verification?.evidence?.passage && (
        <blockquote className="font-serif text-xs italic text-ink">
          “{verification.evidence.passage}”{verification.evidence.page ? ` — p.${verification.evidence.page}` : ''}
        </blockquote>
      )}
      <div className="flex flex-wrap items-center gap-3.5 text-xs">
        <button type="button" onClick={() => onInsert(result, verification)} className="rounded text-accent hover:underline">
          {insertLabel}
        </button>
        <button
          type="button"
          onClick={() => void copyText(result.bibtex).then((ok) => onCopied(copiedMessage(ok, `BibTeX for ${result.key}`)))}
          className="rounded text-accent hover:underline"
        >
          Copy BibTeX
        </button>
        <button
          type="button"
          onClick={() => !saved && onSave(result, verification)}
          aria-pressed={Boolean(saved)}
          disabled={Boolean(saved)}
          className="flex items-center gap-1 rounded text-ink-muted hover:underline disabled:cursor-default disabled:no-underline"
        >
          {saved ? <BookmarkCheck className="size-3.5" aria-hidden="true" /> : <Bookmark className="size-3.5" aria-hidden="true" />}
          {saved ? 'Saved' : 'Save to list'}
        </button>
      </div>
    </li>
  )
}

export function FindSourcesCard({
  selectedIssue,
  onInsert,
  onSave,
  onCopied,
}: {
  selectedIssue: Citation | undefined
  /** Replace the selected issue's citation with this result. */
  onInsert: (issue: Citation, result: SearchResult, verification: Verification | undefined) => void
  onSave: (result: SearchResult, verification: Verification | undefined, claim: string) => void
  onCopied: (message: string) => void
}) {
  const [query, setQuery] = useState(selectedIssue?.claim ?? '')
  const debounced = useDebounced(query, 400)
  const search = useAuthorSearch(debounced)
  const saved = useSavedSources()
  const claim = selectedIssue?.claim ?? debounced

  const insert = (result: SearchResult, verification: Verification | undefined) => {
    if (selectedIssue) onInsert(selectedIssue, result, verification)
    else void copyText(`\\cite{${result.key}}`).then((ok) => onCopied(copiedMessage(ok, `\\cite{${result.key}}`)))
  }

  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="find-sources-title">
      <CardHead id="find-sources-title" title="Find sources" aside={<span className="text-ink-muted">Semantic Scholar · your library</span>} />
      <Input
        id={FIND_SOURCES_INPUT_ID}
        type="search"
        aria-label="Search for a source"
        placeholder="Search a claim, title, author, or DOI"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {debounced.trim() === '' ? (
        <Empty title="Search for a source" hint="Pick an issue above, or type a claim, a title or a DOI." />
      ) : search.isPending ? (
        <p className="flex items-center gap-2 py-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Searching…
        </p>
      ) : search.isError ? (
        <p className="text-sm text-refutes">
          Could not search: {errorMessage(search.error)}{' '}
          <button type="button" onClick={() => void search.refetch()} className="text-accent hover:underline">
            Try again
          </button>
        </p>
      ) : search.data.results.length === 0 ? (
        <Empty title="No sources found" hint="Try a different phrasing, a title, or a DOI." />
      ) : (
        <ul>
          {search.data.results.map((result, index) => (
            <ResultRow
              key={result.id}
              result={result}
              claim={claim}
              auto={index < AUTO_VERIFY}
              saved={savedMatch(result, saved.data)}
              onInsert={insert}
              onCopied={onCopied}
              onSave={(r, verification) => onSave(r, verification, claim)}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}
