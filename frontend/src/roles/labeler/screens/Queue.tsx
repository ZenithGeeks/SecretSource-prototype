/** Papers to label: the ones the team brought in from Scopus, and whether the database is ready. */

import { Check, Download, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { labelingApi, problem, useAssignTopic, useLabelStatus, usePool, type Pool } from '../../../lib/labeling'
import { ScopusAdd } from '../components/ScopusAdd'
import { TeamTopics } from '../components/TeamTopics'

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

type Paper = Pool['papers'][number]

const isFinished = (paper: Paper) => paper.status === 'done' && paper.claims > 0 && paper.judged >= paper.claims

function PaperRow({ paper, me, myTopic, onOpen }: { paper: Paper; me: string; myTopic: string; onOpen: (id: string) => void }) {
  const assign = useAssignTopic()
  const ready = paper.status === 'done'
  const finished = isFinished(paper)
  const others = paper.labelers.filter((name) => name !== me)
  const action = finished ? 'Review' : paper.judged > 0 ? 'Continue' : 'Label'
  return (
    <li className="flex items-stretch gap-2">
      <button
        type="button"
        disabled={!ready}
        onClick={() => onOpen(paper.analysis_id)}
        className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:border-border-subtle"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{paper.title}</span>
          <span className="block text-sm text-ink-muted">
            {paper.topic}
            {paper.topic === myTopic && ' · your topic'}
            {ready && ` · ${paper.claims} claims`}
            {paper.status === 'running' && ' · reading the paper…'}
          </span>
          {ready && paper.claims > 0 && (
            <span className="mt-1.5 block max-w-xs">
              <span className="flex items-center gap-1.5 text-sm text-ink-muted tabular-nums">
                {finished && <Check className="size-4 shrink-0 text-supports" aria-hidden="true" />}
                {finished && <span className="font-medium text-supports">Done</span>}
                {paper.judged} of {paper.claims} claims judged by you
              </span>
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={paper.claims}
                aria-valuenow={Math.min(paper.judged, paper.claims)}
                aria-label={`Claims you judged in ${paper.title}`}
                className="mt-1 block h-1.5 overflow-hidden rounded bg-border-subtle"
              >
                <span
                  className="block h-full bg-supports transition-[width] duration-200"
                  style={{ width: `${Math.min(100, (paper.judged / paper.claims) * 100)}%` }}
                />
              </span>
            </span>
          )}
          {ready && others.length > 0 && <span className="block text-sm text-ink-muted">Also labeled by {others.join(', ')}</span>}
          {paper.status === 'error' && (
            <span role="alert" className="block text-sm text-refutes">
              Could not be read: {paper.reason || 'no open PDF was found'}. Remove it and add another.
            </span>
          )}
        </span>
        {ready && <span className="text-sm font-medium text-accent">{action}</span>}
        {paper.status === 'running' && <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-label="Reading the paper" />}
      </button>
      {paper.mine && (
        <Button
          variant="ghost"
          disabled={assign.isPending}
          onClick={() => {
            if (!window.confirm("Remove this paper from the team's list? Labels already saved are kept.")) return
            assign.mutate({ analysisId: paper.analysis_id, topic: '' })
          }}
        >
          Remove
        </Button>
      )}
    </li>
  )
}

export function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const status = useLabelStatus()
  const pool = usePool()
  const [downloading, setDownloading] = useState<Export | null>(null)
  const [downloadError, setDownloadError] = useState<unknown>(null)

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

      <section aria-labelledby="papers-heading" className="flex flex-col gap-2">
        <h2 id="papers-heading" className="text-sm font-semibold text-ink">
          Papers to label
        </h2>
        {papers.length === 0 ? (
          <Empty title="No papers yet" hint="Search Scopus above and add some. They appear here once their text has been read." />
        ) : (
          <ul className="flex flex-col gap-2">
            {papers.map((paper) => (
              <PaperRow key={paper.analysis_id} paper={paper} me={pool.data?.me ?? ''} myTopic={myTopic} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>
    </FadeIn>
  )
}
