/** Writer Find a source — search the library (and open access) for a source that backs a
 * sentence. `?q=` deep-links the query. With `?claim=<id>` in the URL (arrived from Draft
 * check's "Replace citation"), "Cite this" on any result replaces that claim's citation and
 * hands back to `onReplaced`; without it, "Cite this" copies the cite key instead. */

import { Copy, Download, Loader2, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty, Input, StandingBadge } from '../../../components/ui'
import { useSourceSearch, useWriterActions } from '../../../lib/useWriter'
import type { Source } from '../../../lib/writer'
import { cn } from '../../../lib/utils'

const INITIAL_QUERY = 'compressing token-level embeddings makes the index 6–10× smaller'

const VERDICT_VERB: Record<'refutes' | 'insufficient', string> = {
  refutes: 'contradicts',
  insufficient: 'is silent on',
}

function sourceMeta(result: { inLibrary: boolean; openAccess: boolean; isCurrentCitation: boolean; citedByLibrary: boolean }) {
  const parts = [result.inLibrary ? 'in library' : 'open access · not in library']
  if (result.citedByLibrary) parts.push('cited by your library')
  if (result.isCurrentCitation) parts.push('your current citation')
  return `· ${parts.join(' · ')}`
}

/** Best-effort BibTeX from what a Source has — there's no raw BibTeX field in the mock data. */
function toBibTeX(source: Source): string {
  const year = source.citation.match(/\((\d{4})\)/)?.[1] ?? ''
  const authorKey = source.citation
    .split(/\s+(?:et al\.|&)/)[0]
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  const author = source.citation.replace(/\s*\(\d{4}\)\s*$/, '')
  return `@article{${authorKey}${year},\n  title={${source.title}},\n  author={${author}},\n  year={${year}}\n}`
}

function readQueryParam() {
  const params = new URLSearchParams(window.location.search)
  return { q: params.get('q') ?? undefined, claimId: params.get('claim') ?? undefined }
}

function writeQueryParam(q: string) {
  const params = new URLSearchParams(window.location.search)
  if (q && q.trim() !== INITIAL_QUERY.trim()) params.set('q', q)
  else params.delete('q')
  window.history.replaceState(null, '', `?${params.toString()}`)
}

export function FindASource({ onReplaced }: { onReplaced: (claimId: string) => void }) {
  const initial = readQueryParam()
  const [query, setQuery] = useState(initial.q ?? INITIAL_QUERY)
  const [submittedQuery, setSubmittedQuery] = useState(initial.q ?? INITIAL_QUERY)
  const [libraryOnly, setLibraryOnly] = useState(true)
  const [openAccess, setOpenAccess] = useState(true)
  const [citedByLibrary, setCitedByLibrary] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const claimId = initial.claimId
  // The mock only "knows" how to semantically match the current sentence (the scripted
  // default results) — it has no real embedding search. Treat the untouched default query
  // as "no text filter" so the demo's baked-in match set still shows; a query the user
  // actually typed does a real title/citation substring filter (title/authors/venue/year).
  const effectiveQuery = submittedQuery.trim() === INITIAL_QUERY.trim() ? '' : submittedQuery
  const search = useSourceSearch(effectiveQuery, { libraryOnly, openAccess, citedByLibrary })
  const actions = useWriterActions()

  const copy = (id: string, text: string) => {
    try {
      navigator.clipboard.writeText(text).catch(() => {})
    } catch {
      return
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
  }

  const citeSource = (result: Source) => {
    if (claimId) {
      actions.replaceCitation(claimId, result.id)
      onReplaced(claimId)
    } else {
      copy(result.id, result.citation)
    }
  }

  return (
    <>
      <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">Find the source that actually says it</h1>

      <form
        className="flex gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setSubmittedQuery(query)
          writeQueryParam(query)
        }}
      >
        <Input
          aria-label="Search for a source"
          placeholder={INITIAL_QUERY}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-2xl"
        />
        <Button type="submit" className="shrink-0">
          <Search className="size-4" />
          Search
        </Button>
      </form>

      {search.data && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-muted">Search in</p>
          {[
            { label: `My library (${search.data.libraryCount})`, active: libraryOnly, onToggle: () => setLibraryOnly((v) => !v) },
            { label: 'Open access', active: openAccess, onToggle: () => setOpenAccess((v) => !v) },
            { label: 'Cited by my library', active: citedByLibrary, onToggle: () => setCitedByLibrary((v) => !v) },
          ].map(({ label, active, onToggle }) => (
            <button
              key={label}
              type="button"
              onClick={onToggle}
              aria-pressed={active}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium text-ink',
                active ? 'border-accent bg-accent-soft' : 'border-border-subtle hover:border-accent',
              )}
            >
              {label}
            </button>
          ))}
          <p className="text-xs text-ink-muted">· Matching by meaning of passages, not keywords</p>
        </div>
      )}

      {search.isPending && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Searching your library…
        </p>
      )}

      {search.isError && (
        <Card className="border-refutes text-refutes">
          Could not search: {(search.error as Error).message}
        </Card>
      )}

      {search.data && (
        <>
          <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="text-[13px] text-ink">
              Your current citation for this sentence is {search.data.currentCitation.label}, which{' '}
              {VERDICT_VERB[search.data.currentCitationVerdict]} it. Best match below says it directly.
            </p>
          </div>

          {search.data.results.length === 0 ? (
            <Empty title="No sources found" hint="Try a different phrasing, or search open access too." />
          ) : (
            <div className="flex flex-col gap-3">
              {search.data.results.map((result) => (
                <article
                  key={result.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border bg-surface p-4',
                    result.isBestMatch ? 'border-2 border-accent' : 'border-border-subtle',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StandingBadge standing={result.verdict} />
                    <p className="text-xs font-medium text-ink-muted">similarity {result.similarity.toFixed(2)}</p>
                    <p className="text-xs text-ink-muted">{sourceMeta(result)}</p>
                    {result.isBestMatch && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                        best match
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-ink">
                    {result.citation}. {result.title}
                  </p>

                  <blockquote
                    className={cn(
                      'border-l-2 pl-3 text-sm italic',
                      result.isCurrentCitation ? 'border-border-subtle text-ink-muted' : 'border-accent text-ink',
                    )}
                  >
                    {result.quote}
                    <p className="mt-1 text-xs not-italic text-accent">{result.location} · show in the paper</p>
                  </blockquote>

                  <div className="flex flex-wrap gap-2">
                    <Button variant={result.isBestMatch ? 'solid' : 'ghost'} onClick={() => citeSource(result)}>
                      <Copy className="size-4" />
                      {copiedId === result.id ? 'Copied!' : claimId ? 'Cite this' : 'Cite this (copy)'}
                    </Button>
                    {!result.inLibrary && (
                      <Button variant="ghost" onClick={() => actions.markInLibrary(result.id)}>
                        <Download className="size-4" />
                        Add to library
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => copy(`${result.id}-bib`, toBibTeX(result))}>
                      <Copy className="size-4" />
                      {copiedId === `${result.id}-bib` ? 'Copied!' : 'BibTeX'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
