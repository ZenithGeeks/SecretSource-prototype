/** Papers to label: the ones the team brought in from Scopus, and whether the database is ready. */

import { ChevronDown, Download, EyeOff, Loader2, Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Mascot } from '../../../components/Mascot'
import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { labelingApi, problem, useLabelStatus, usePool } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { GuideButton } from '../components/GuideButton'
import { NoMatch, PaperFilters } from '../components/PaperFilters'
import { PaperTable } from '../components/PaperTable'
import { ScopusAdd } from '../components/ScopusAdd'
import { TeamTopics } from '../components/TeamTopics'
import { isFinished, matches, NO_FILTERS, readFilters, teamStatusOf, valueLabel, writeFilters, type Filters } from '../paperFilters'

type Export = Parameters<typeof labelingApi.exportFile>[0]
type Scope = NonNullable<Parameters<typeof labelingApi.exportFile>[1]>

const DOWNLOADS: { tab: Export; file: string; label: string }[] = [
  { tab: 'labels', file: 'evidence_labels.csv', label: 'Download labels CSV' },
  { tab: 'dspy_claims', file: 'dspy_claims.jsonl', label: 'Download DSPy claims (JSONL)' },
  { tab: 'dspy_verdicts', file: 'dspy_verdicts.jsonl', label: 'Download DSPy verdicts (JSONL)' },
]

const SCOPES: { scope: Scope; label: string }[] = [
  { scope: 'mine', label: 'Your labels' },
  { scope: 'team', label: 'Whole team' },
]

async function download(tab: Export, file: string, scope: Scope) {
  const blob = await labelingApi.exportFile(tab, scope)
  // A team file gets its own name, so it never overwrites your own download.
  const name = scope === 'team' ? file.replace('.', '_team.') : file
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name })
  link.click()
  URL.revokeObjectURL(link.href)
}

function Setup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-2 border-insufficient">
      <p className="flex items-center gap-2 font-medium text-insufficient">
        <TriangleAlert className="size-4" /> {title}
      </p>
      <p className="text-sm text-ink-muted">{children}</p>
    </Card>
  )
}

export function Queue({
  onOpen,
  onOpenLabels,
  onShowBlind,
}: {
  onOpen: (id: string) => void
  onOpenLabels?: (id: string) => void
  onShowBlind: () => void
}) {
  const status = useLabelStatus()
  const pool = usePool()
  const [downloading, setDownloading] = useState<Export | null>(null)
  const [scope, setScope] = useState<Scope>('mine')
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const [showExports, setShowExports] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showTeam, setShowTeam] = useState(false)
  const [filters, setFilters] = useState<Filters>(() => readFilters(window.location.search))

  useEffect(() => {
    const query = writeFilters(window.location.search, filters)
    // The entry's state holds the list's scroll (LabelerApp), so it is kept.
    window.history.replaceState(window.history.state, '', query ? `?${query}` : window.location.pathname)
  }, [filters])

  if (status.isLoading) return <LoadingScreen />
  if (status.error) {
    const { title, hint } = problem(status.error)
    return (
      <div className="flex flex-col items-center gap-3">
        <Empty title={title} hint={hint} />
        <Button variant="ghost" onClick={() => void status.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const myTopic = pool.data?.people.find((p) => p.name === pool.data?.me)?.topic ?? ''
  // Every paper is listed; one the viewer checks blind is marked, and Blind checks lists it too (#867).
  const blind = new Set(pool.data?.blind ?? [])
  const lead = pool.data?.lead ?? false
  // The viewer's unfinished papers first, so the list opens on work to do; then their own
  // topic, then by topic.
  const papers = [...(pool.data?.papers ?? [])].sort(
    (a, b) =>
      Number(isFinished(a)) - Number(isFinished(b)) ||
      Number(b.topic === myTopic) - Number(a.topic === myTopic) ||
      a.topic.localeCompare(b.topic),
  )
  const me = pool.data?.me ?? ''
  const shown = papers.filter((paper) => matches(paper, filters, me))
  const nextPaper = papers.find((paper) => paper.status === 'done' && !isFinished(paper))
  const reading = papers.filter((paper) => paper.status === 'running').length
  // Any "Added by" choice, same as Topic: one or more selected just broadens which papers
  // show (OR'd, already how `shown` works). How much of what they brought in is done, by the
  // whole team, not just the viewer — so anyone can see what is left.
  const personSummary =
    filters.addedBy.length > 0
      ? shown.reduce(
          (totals, paper) => ({ ...totals, [teamStatusOf(paper)]: totals[teamStatusOf(paper)] + 1 }),
          { done: 0, started: 0, none: 0 },
        )
      : null
  return (
    <FadeIn className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mascot role="labeler" size={44} className="hidden shrink-0 sm:block" />
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">Label data</h1>
            <p className="text-sm text-ink-muted">
              Signed in as {status.data?.annotator}. You judge every claim and passage; nothing is saved until you save it.
            </p>
            <GuideButton />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {nextPaper && (
            <Button
              onClick={() => onOpen(nextPaper.analysis_id)}
              aria-label={`Continue: ${nextPaper.title}`}
              title={nextPaper.title}
              className="max-w-md"
            >
              {/* Only the title is cut short, so the button always says what it does. */}
              <span className="shrink-0">Continue:</span>
              <span className="min-w-0 truncate">{nextPaper.title}</span>
            </Button>
          )}
          {pool.data && status.data?.scopus && (
            <Button variant="ghost" aria-expanded={showAdd} onClick={() => setShowAdd((open) => !open)}>
              <Plus className="size-4" aria-hidden="true" />
              Add papers
              <ChevronDown className={cn('size-4 transition-transform', showAdd && 'rotate-180')} aria-hidden="true" />
            </Button>
          )}
          <Button variant="ghost" aria-expanded={showExports} onClick={() => setShowExports((open) => !open)}>
            <Download className="size-4" aria-hidden="true" />
            Downloads
            <ChevronDown className={cn('size-4 transition-transform', showExports && 'rotate-180')} aria-hidden="true" />
          </Button>
          {pool.data && (
            <Button variant="ghost" aria-expanded={showTeam} onClick={() => setShowTeam((open) => !open)}>
              Team
              <ChevronDown className={cn('size-4 transition-transform', showTeam && 'rotate-180')} aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      {showExports && (
        <Card className="flex flex-wrap items-center gap-2 py-2.5">
          {/* Only a lead may download the whole team's labels: with them a blind check would not be blind. */}
          {lead && (
            <div role="radiogroup" aria-label="Whose labels to download" className="flex rounded-lg border border-border-subtle p-0.5">
              {SCOPES.map((option) => (
                <button
                  key={option.scope}
                  type="button"
                  role="radio"
                  aria-checked={scope === option.scope}
                  onClick={() => setScope(option.scope)}
                  className={cn(
                    'min-h-9 rounded-md px-3 text-sm',
                    scope === option.scope ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {DOWNLOADS.map(({ tab, file, label }) => (
            <Button
              key={tab}
              variant="ghost"
              disabled={!status.data?.configured || downloading !== null}
              onClick={() => {
                setDownloading(tab)
                setDownloadError(null)
                download(tab, file, lead ? scope : 'mine')
                  .catch(setDownloadError)
                  .finally(() => setDownloading(null))
              }}
            >
              {downloading === tab ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {label}
            </Button>
          ))}
        </Card>
      )}

      {downloadError !== null && (
        <p role="alert" className="text-sm text-refutes">
          {problem(downloadError).title}. {problem(downloadError).hint}
        </p>
      )}

      {!status.data?.configured && (
        <Setup title="Labels cannot be saved yet">
          Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in the gateway's <code>.env</code>, run the{' '}
          <code>labeling_rows</code> migration, then reload.
        </Setup>
      )}

      {blind.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm">
          <EyeOff className="size-4 shrink-0 text-accent" aria-hidden />
          <p className="min-w-0 flex-1 text-ink">
            You have {blind.size} {blind.size === 1 ? 'paper' : 'papers'} to check blind.
          </p>
          <Button variant="ghost" onClick={onShowBlind}>
            Open blind checks
          </Button>
        </div>
      )}

      {pool.data && showTeam && <TeamTopics pool={pool.data} />}
      {pool.data && showAdd && <ScopusAdd pool={pool.data} myTopic={myTopic} />}
      {pool.data && !status.data?.scopus && (
        <Setup title="Scopus search is not set up yet">
          Set <code>SCOPUS_API_KEY</code> (a key from dev.elsevier.com) in the gateway's <code>.env</code>, then reload.
        </Setup>
      )}

      <section aria-labelledby="papers-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* "All papers", not the screen's name again: the breadcrumb and sidebar already say it. */}
          <h2 id="papers-heading" className="text-sm font-semibold text-ink">
            All papers
          </h2>
          {reading > 0 && (
            <p className="text-xs text-ink-muted">
              Reading {reading} {reading === 1 ? 'paper' : 'papers'}. This list updates by itself.
            </p>
          )}
        </div>
        {pool.isLoading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading papers…
          </p>
        ) : papers.length === 0 ? (
          <Empty title="No papers yet" hint="Use Add papers to search Scopus. A paper appears here once its text has been read." />
        ) : (
          <>
            {/* A paper is listed only once the pool has loaded, so `pool.data` is set; `?? []` only satisfies the type. */}
            {/* v8 ignore start -- @preserve */}
            <PaperFilters papers={papers} topics={pool.data?.topics ?? []} me={me} filters={filters} onChange={setFilters} shown={shown.length} />
            {/* v8 ignore stop -- @preserve */}
            {personSummary && (
              <Card role="status" className="py-3 text-sm text-ink">
                {filters.addedBy.map((who) => valueLabel('addedBy', who, me)).join(', ')}: {personSummary.done} done ·{' '}
                {personSummary.started} in progress · {personSummary.none} not started
              </Card>
            )}
            {shown.length === 0 ? (
              <NoMatch filters={filters} me={me} onClear={() => setFilters(NO_FILTERS)} />
            ) : (
              <PaperTable
                papers={shown}
                me={me}
                myTopic={myTopic}
                lead={lead}
                blind={blind}
                onOpen={onOpen}
                onOpenLabels={onOpenLabels}
              />
            )}
          </>
        )}
      </section>
    </FadeIn>
  )
}
