/**
 * Find a source (Figma 597:3930): "Find the passage that actually says it, in your library or
 * open access." One search over Semantic Scholar merged with the user's own .bib entries and
 * saved sources; the scope chips filter that one answer on the client. The top results are
 * verified against the sentence on their own, the rest on request, so every card carries a
 * real verdict and the passage it rests on — never a guessed one.
 *
 * Opened from "Find a replacement" on Check a draft (or the editor), it knows which citation
 * to replace: "Cite this" then rewrites the \cite and records the resolution. Otherwise
 * "Cite this" copies the \cite to the clipboard.
 */

import { Copy, Download, Loader2, Search, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'

import type { Target } from '../../../components/PageViewer'
import { PageViewer } from '../../../components/PageViewer'
import { Button, Card, Empty, FadeIn, Input } from '../../../components/ui'
import { api } from '../../../lib/api'
import { errorMessage } from '../../../lib/author'
import { useAuthorActions, useAuthorCheck, useAuthorDraft, useAuthorProjects, useAuthorSearch, useSavedSources } from '../../../lib/useAuthor'
import { cn } from '../../../lib/utils'
import { VERDICTS } from '../../../lib/verdict'
import type { Citation, SearchResult, Verification } from '../../../types/draftCheck'
import { AUTO_VERIFY, copiedMessage, copyText, savedMatch } from '../searchHelpers'
import { Toast } from '../components/Toast'
import { VerifiedBadge } from '../components/VerifiedBadge'
import { citedBy, replacementLabel, sourceLabel } from '../labels'
import type { ReplacementRequest } from './DraftCheck'

type Scope = { library: boolean; openAccess: boolean; cited: boolean }

/** OR across the active chips; every chip off shows everything (the way #107's review settled it). */
function inScope(result: SearchResult, scope: Scope): boolean {
  if (!scope.library && !scope.openAccess && !scope.cited) return true
  return (scope.library && result.inLibrary) || (scope.openAccess && result.openAccess) || (scope.cited && Boolean(result.cited))
}

const VERDICT_VERB: Record<string, string> = {
  refutes: 'contradicts it',
  insufficient: 'is silent on it',
  unavailable: 'could not be read',
  unchecked: 'was not checked',
  supports: 'backs it',
}

function ResultCard({
  result,
  claim,
  auto,
  best,
  saved,
  replacing,
  onCite,
  onSave,
  onCopied,
  onShow,
}: {
  result: SearchResult
  claim: string
  auto: boolean
  best: boolean
  saved: boolean
  replacing: boolean
  onCite: (result: SearchResult, verification: Verification | undefined) => void
  onSave: (result: SearchResult, verification: Verification | undefined) => void
  onCopied: (message: string) => void
  onShow: (target: Target) => void
}) {
  const [verification, setVerification] = useState<Verification>()
  const [locating, setLocating] = useState(false)
  const meta = [
    `similarity ${result.similarity.toFixed(2)}`,
    result.inLibrary ? `in ${result.bibName ?? 'library'}` : 'not in library',
    result.openAccess ? 'open access' : null,
    result.citedBy !== null ? `cited ${citedBy(result.citedBy)}` : null,
  ].filter(Boolean)

  const show = async () => {
    const evidence = verification?.evidence
    if (!evidence?.pdf) return
    setLocating(true)
    try {
      const found = await api.findInPaper(evidence.pdf, evidence.passage, evidence.page ?? undefined).catch(() => null)
      onShow({
        paper: evidence.pdf,
        label: `Passage in ${result.title}`,
        quote: evidence.passage,
        source: found && found.page ? (found as Target['source']) : null,
        page: evidence.page ?? undefined,
      })
    } finally {
      setLocating(false)
    }
  }

  return (
    <article className={cn('flex flex-col gap-2 rounded-xl border bg-surface p-4', best ? 'border-2 border-accent' : 'border-border-subtle')}>
      <div className="flex flex-wrap items-center gap-2">
        {claim ? <VerifiedBadge claim={claim} identifier={result.identifier} auto={auto} onVerified={setVerification} /> : null}
        <p className="text-xs text-ink-muted">· {meta.join(' · ')}</p>
        {best && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">best match</span>}
      </div>
      <p className="text-sm font-medium text-ink">
        {result.authors}
        {result.year ? ` (${result.year})` : ''}. {result.title}
        {result.venue ? ` ${result.venue}.` : ''}
      </p>
      {verification?.evidence?.passage ? (
        <blockquote className="border-l-2 border-accent pl-3 text-sm italic text-ink">
          “{verification.evidence.passage}”
          <p className="mt-1 text-xs not-italic text-accent">
            {verification.evidence.page ? `p.${verification.evidence.page} · ` : ''}
            <button type="button" onClick={() => void show()} className="rounded hover:underline" disabled={locating}>
              {locating ? 'locating…' : 'show in the paper'}
            </button>
          </p>
        </blockquote>
      ) : verification?.explanation ? (
        <p className="text-sm text-ink-muted">{verification.explanation}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant={best ? 'solid' : 'ghost'} onClick={() => onCite(result, verification)} disabled={replacing}>
          <Copy className="size-4" aria-hidden="true" />
          Cite this
        </Button>
        {!saved && !result.inLibrary && (
          <Button variant="ghost" onClick={() => onSave(result, verification)}>
            <Download className="size-4" aria-hidden="true" />
            Add to library
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => void copyText(result.bibtex).then((ok) => onCopied(copiedMessage(ok, `BibTeX for ${result.key}`)))}
        >
          <Copy className="size-4" aria-hidden="true" />
          BibTeX
        </Button>
      </div>
    </article>
  )
}

export function FindASource({
  initialQuery,
  replacement,
  onQueryChange,
  onReplaced,
  onTargetChange,
}: {
  initialQuery: string
  /** The citation "Cite this" should replace, from Check a draft's "Find a replacement". */
  replacement?: ReplacementRequest
  /** The submitted query, for the URL. */
  onQueryChange: (query: string) => void
  /** The citation was replaced: back to Check a draft. */
  onReplaced: (draftId: string) => void
  onTargetChange?: (open: boolean) => void
}) {
  const [query, setQuery] = useState(initialQuery || replacement?.claim || '')
  const [submitted, setSubmitted] = useState(query)
  const [scope, setScope] = useState<Scope>({ library: false, openAccess: false, cited: false })
  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])
  const [target, setTarget] = useState<Target | null>(null)
  const [replacing, setReplacing] = useState(false)

  const search = useAuthorSearch(submitted)
  const saved = useSavedSources()
  const projects = useAuthorProjects()
  const actions = useAuthorActions()
  const check = useAuthorCheck(replacement?.checkId ?? null)
  const draft = useAuthorDraft(replacement?.draftId ?? null)
  const citation: Citation | undefined = check.data?.citations?.find((c) => c.id === replacement?.citationId)
  const claim = replacement?.claim ?? submitted

  const showTarget = (next: Target | null) => {
    setTarget(next)
    onTargetChange?.(next !== null)
  }

  const submit = () => {
    const q = query.trim()
    setSubmitted(q)
    onQueryChange(q)
  }

  const cite = async (result: SearchResult, verification: Verification | undefined) => {
    if (replacement && citation && draft.data) {
      setReplacing(true)
      try {
        await actions.replaceCitation(draft.data, replacement.checkId, citation, result, verification)
        onReplaced(replacement.draftId)
      } catch (error) {
        setToast(`Could not replace the citation: ${errorMessage(error)}`)
      } finally {
        setReplacing(false)
      }
      return
    }
    const ok = await copyText(`\\cite{${result.key}}`)
    setToast(ok ? `Copied \\cite{${result.key}} — add the entry with BibTeX if it is not in your .bib` : copiedMessage(false, ''))
  }

  const save = async (result: SearchResult, verification: Verification | undefined) => {
    try {
      const projectId = draft.data?.projectId ?? (projects.data?.length === 1 ? projects.data[0].id : null)
      await actions.saveSource({ ...result, projectId, claim, verdict: verification?.verdict ?? null, evidence: verification?.evidence ?? null })
      setToast(`Saved ${replacementLabel(result)} to ${projectId ? 'the project' : 'Unsorted sources'}`)
    } catch (error) {
      setToast(`Could not save: ${errorMessage(error)}`)
    }
  }

  const results = search.data?.results.filter((r) => inScope(r, scope)) ?? []
  const bestId = results.find((r) => r.inLibrary)?.id ?? results[0]?.id

  return (
    <FadeIn className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Find a source</h1>
        <p className="text-sm text-ink-muted">Find the passage that actually says it, in your library or open access.</p>
      </header>

      <form
        className="flex gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          aria-label="Search for a source"
          placeholder="compressing token-level embeddings makes the index 6–10× smaller"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" className="shrink-0" disabled={!query.trim()}>
          <Search className="size-4" aria-hidden="true" />
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-ink-muted">Search in</p>
        {[
          { key: 'library' as const, label: `My library${search.data ? ` (${search.data.libraryCount})` : ''}` },
          { key: 'openAccess' as const, label: 'Open access' },
          { key: 'cited' as const, label: 'Cited by my drafts' },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setScope((s) => ({ ...s, [key]: !s[key] }))}
            aria-pressed={scope[key]}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium text-ink',
              scope[key] ? 'border-accent bg-accent-soft' : 'border-border-subtle hover:border-accent',
            )}
          >
            {label}
          </button>
        ))}
        <p className="text-xs text-ink-muted">· Ranked by words shared with the query; verified against the sentence when checked</p>
      </div>

      {replacement && citation && (
        <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-[13px] text-ink">
            Your current citation for this sentence is {sourceLabel(citation)}, which {VERDICT_VERB[citation.verdict]}
            {citation.verdict !== 'supports' && citation.verdict !== 'unchecked' ? ` (${VERDICTS[citation.verdict].legend})` : ''}.
            “Cite this” on a result replaces \cite{'{'}
            {citation.key}
            {'}'} in {citation.file} L{citation.line}.
          </p>
        </div>
      )}

      {submitted && search.isPending && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Searching Semantic Scholar and your library…
        </p>
      )}
      {search.isError && (
        <Card className="flex flex-col items-start gap-2 border-refutes text-refutes">
          <p>Could not search: {errorMessage(search.error)}</p>
          <Button variant="ghost" onClick={() => void search.refetch()}>
            Try again
          </Button>
        </Card>
      )}
      {!submitted && <Empty title="Search for a source" hint="Paste the sentence you need a source for, or a title, an author, or a DOI." />}

      {search.data && (
        <div className={target ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : undefined}>
          {results.length === 0 ? (
            <Empty
              title="No sources found"
              hint={search.data.results.length ? 'Nothing in that scope — widen it.' : 'Try a different phrasing, a title, or a DOI.'}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {results.map((result, index) => (
                <ResultCard
                  key={result.id}
                  result={result}
                  claim={claim}
                  auto={index < AUTO_VERIFY}
                  best={result.id === bestId}
                  saved={Boolean(savedMatch(result, saved.data))}
                  replacing={replacing}
                  onCite={(r, v) => void cite(r, v)}
                  onSave={(r, v) => void save(r, v)}
                  onCopied={setToast}
                  onShow={showTarget}
                />
              ))}
            </div>
          )}
          {target && (
            <div className="xl:sticky xl:top-6 xl:z-20 xl:self-start">
              <PageViewer key={target.paper} target={target} onClose={() => showTarget(null)} />
            </div>
          )}
        </div>
      )}

      <Toast message={toast} onClose={closeToast} />
    </FadeIn>
  )
}
