/** Papers to label: the ones the team brought in from Scopus, and whether the database is ready. */

import { Download, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { labelingApi, problem, useLabelStatus, usePool } from '../../../lib/labeling'
import { NoMatch, PaperFilters } from '../components/PaperFilters'
import { PaperTable } from '../components/PaperTable'
import { ScopusAdd } from '../components/ScopusAdd'
import { TeamTopics } from '../components/TeamTopics'
import { isFinished, matches, NO_FILTERS, readFilters, writeFilters, type Filters } from '../paperFilters'

type Export = Parameters<typeof labelingApi.exportFile>[0]

const DOWNLOADS: { tab: Export; file: string; label: string }[] = [
  { tab: 'labels', file: 'evidence_labels.csv', label: 'Download labels CSV' },
  { tab: 'dspy_claims', file: 'dspy_claims.jsonl', label: 'Download DSPy claims (JSONL)' },
  { tab: 'dspy_verdicts', file: 'dspy_verdicts.jsonl', label: 'Download DSPy verdicts (JSONL)' },
]

async function download(tab: Export, file: string) {
  const blob = await labelingApi.exportFile(tab)
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file })
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

export function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const status = useLabelStatus()
  const pool = usePool()
  const [downloading, setDownloading] = useState<Export | null>(null)
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const [filters, setFilters] = useState<Filters>(() => readFilters(window.location.search))

  useEffect(() => {
    const query = writeFilters(window.location.search, filters)
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
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
  // Papers of the viewer's own topic first, then by topic; within a topic, unfinished before finished.
  const papers = [...(pool.data?.papers ?? [])].sort(
    (a, b) =>
      Number(b.topic === myTopic) - Number(a.topic === myTopic) ||
      a.topic.localeCompare(b.topic) ||
      Number(isFinished(a)) - Number(isFinished(b)),
  )
  const me = pool.data?.me ?? ''
  const shown = papers.filter((paper) => matches(paper, filters, me))
  return (
    <FadeIn className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">Label data</h1>
          <p className="text-sm text-ink-muted">
            Signed in as {status.data?.annotator}. You judge every claim and passage; nothing is saved until you save it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {DOWNLOADS.map(({ tab, file, label }) => (
            <Button
              key={tab}
              variant="ghost"
              disabled={!status.data?.configured || downloading !== null}
              onClick={() => {
                setDownloading(tab)
                setDownloadError(null)
                download(tab, file)
                  .catch(setDownloadError)
                  .finally(() => setDownloading(null))
              }}
            >
              {downloading === tab ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {label}
            </Button>
          ))}
        </div>
      </header>

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

      {pool.data && <TeamTopics pool={pool.data} />}

      {pool.data &&
        (status.data?.scopus ? (
          <ScopusAdd pool={pool.data} myTopic={myTopic} />
        ) : (
          <Setup title="Scopus search is not set up yet">
            Set <code>SCOPUS_API_KEY</code> (a key from dev.elsevier.com) in the gateway's <code>.env</code>, then reload.
          </Setup>
        ))}

      <section aria-labelledby="papers-heading" className="flex flex-col gap-3">
        <h2 id="papers-heading" className="text-sm font-semibold text-ink">
          Papers to label
        </h2>
        {papers.length === 0 ? (
          <Empty title="No papers yet" hint="Search Scopus above and add some. They appear here once their text has been read." />
        ) : (
          <>
            <PaperFilters papers={papers} topics={pool.data?.topics ?? []} me={me} filters={filters} onChange={setFilters} shown={shown.length} />
            {shown.length === 0 ? (
              <NoMatch filters={filters} me={me} onClear={() => setFilters(NO_FILTERS)} />
            ) : (
              <PaperTable papers={shown} me={me} myTopic={myTopic} onOpen={onOpen} />
            )}
          </>
        )}
      </section>
    </FadeIn>
  )
}
