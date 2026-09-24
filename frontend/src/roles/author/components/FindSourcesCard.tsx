/** "Find sources": search Semantic Scholar · Crossref · arXiv (mocked) for a claim. A result
 * can be inserted for the selected issue, its BibTeX copied, or saved for later. */

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card, Empty, Input } from '../../../components/ui'
import { useAuthorSearch } from '../../../lib/useAuthor'
import type { Citation, SearchResult } from '../../../types/draftCheck'
import { citedBy, FIND_SOURCES_INPUT_ID } from '../labels'
import { CardHead } from './CardHead'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

function ResultRow({
  result,
  suggestedFor,
  onInsert,
  onCopyBibtex,
  saved,
  onToggleSaved,
}: {
  result: SearchResult
  /** 1-based index of the open issue this result fixes, if any. */
  suggestedFor: number | undefined
  onInsert: () => void
  onCopyBibtex: () => void
  saved: boolean
  onToggleSaved: () => void
}) {
  const meta = [
    result.authors,
    `${result.venue} ${result.year}`,
    `cited ${citedBy(result.citedBy)}`,
    result.openAccess ? 'open access' : null,
    suggestedFor === undefined ? `similarity ${result.similarity.toFixed(2)}` : null,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-[3px] border-b border-border-subtle py-2">
      {suggestedFor !== undefined && (
        <p className="text-[11px] font-medium text-accent">
          Suggested fix for issue {suggestedFor} · similarity {result.similarity.toFixed(2)}
        </p>
      )}
      <p className="text-[13px] font-medium text-ink">{result.title}</p>
      <p className="text-xs text-ink-muted">{meta.join(' · ')}</p>
      <div className="flex flex-wrap gap-3.5 text-xs">
        <button type="button" onClick={onInsert} className="rounded text-accent hover:underline">
          Insert \cite
        </button>
        <button type="button" onClick={onCopyBibtex} className="rounded text-accent hover:underline">
          Copy BibTeX
        </button>
        <button type="button" onClick={onToggleSaved} aria-pressed={saved} className="rounded text-ink-muted hover:underline">
          {saved ? 'Saved' : 'Save to list'}
        </button>
      </div>
    </li>
  )
}

export function FindSourcesCard({
  issues,
  selectedIssue,
  onInsert,
  onCopied,
}: {
  issues: Citation[]
  selectedIssue: Citation | undefined
  /** Replace the selected issue's citation with this result. */
  onInsert: (issue: Citation, result: SearchResult) => void
  onCopied: (what: string) => void
}) {
  const [query, setQuery] = useState('')
  const search = useAuthorSearch(useDebounced(query, 300))
  const [saved, setSaved] = useState<Set<string>>(new Set())

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    onCopied(what)
  }

  const toggleSaved = (id: string) =>
    setSaved((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="find-sources-title">
      <CardHead id="find-sources-title" title="Find sources" aside={<span className="text-ink-muted">Semantic Scholar · Crossref · arXiv</span>} />
      <Input
        id={FIND_SOURCES_INPUT_ID}
        type="search"
        aria-label="Search for a source"
        placeholder="Search a claim, title, author, or DOI"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {search.isPending ? (
        <p className="flex items-center gap-2 py-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Searching…
        </p>
      ) : search.isError ? (
        <p className="text-sm text-refutes">
          Could not search: {(search.error as Error).message}{' '}
          <button type="button" onClick={() => search.refetch()} className="text-accent hover:underline">
            Try again
          </button>
        </p>
      ) : search.data.length === 0 ? (
        <Empty title="No sources found" hint="Try a different phrasing, a title, or a DOI." />
      ) : (
        <ul>
          {search.data.map((result) => {
            const issueIndex = issues.findIndex((c) => c.id === result.suggestedForCitationId)
            return (
              <ResultRow
                key={result.id}
                result={result}
                suggestedFor={issueIndex >= 0 ? issueIndex + 1 : undefined}
                onInsert={() => {
                  const target = issueIndex >= 0 ? issues[issueIndex] : selectedIssue
                  if (target) onInsert(target, result)
                  else void copy(`\\cite{${result.key}}`, `\\cite{${result.key}}`)
                }}
                onCopyBibtex={() => void copy(result.bibtex, `BibTeX for ${result.key}`)}
                saved={saved.has(result.id)}
                onToggleSaved={() => toggleSaved(result.id)}
              />
            )
          })}
        </ul>
      )}
    </Card>
  )
}
