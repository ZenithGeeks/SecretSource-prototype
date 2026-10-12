/** Papers to label: the person's finished analyses, and whether the Sheet is ready to take rows. */

import { Download, ExternalLink, TriangleAlert } from 'lucide-react'

import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { paperName } from '../../../lib/api'
import { labelingApi, problem, useAssignTopic, useLabelStatus, usePool } from '../../../lib/labeling'
import { useAnalyses } from '../../../lib/useAnalysis'
import { TeamTopics } from '../components/TeamTopics'
import { TopicSelect } from '../components/TopicSelect'

async function download() {
  const blob = await labelingApi.exportCsv('labels')
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'evidence_labels.csv',
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

function Setup({ share }: { share: string }) {
  return (
    <Card className="flex flex-col gap-2 border-insufficient">
      <p className="flex items-center gap-2 font-medium text-insufficient">
        <TriangleAlert className="size-4" /> The Sheet is not set up yet
      </p>
      <p className="text-sm text-ink-muted">
        Set <code>LABELING_SHEET_ID</code> and <code>LABELING_GOOGLE_CREDENTIALS</code> (a service-account key) in the
        gateway's <code>.env</code>, share the Sheet with that account as an editor, then reload.
        {share && (
          <>
            {' '}
            Share it with <code>{share}</code>.
          </>
        )}
      </p>
    </Card>
  )
}

export function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const status = useLabelStatus()
  const analyses = useAnalyses()
  const pool = usePool()
  const assign = useAssignTopic()

  if (status.isLoading || analyses.isLoading) return <LoadingScreen />
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

  const ready = (analyses.data ?? []).filter((a) => a.status === 'done' && a.claims.length > 0)
  const myTopic = pool.data?.people.find((p) => p.name === pool.data?.me)?.topic ?? ''
  const sharedAs = new Map((pool.data?.papers ?? []).map((p) => [p.analysis_id, p.topic]))
  // Papers of the team's other people: yours first by topic, then the rest.
  const mine = new Set(ready.map((a) => a.id))
  const shared = (pool.data?.papers ?? [])
    .filter((p) => !mine.has(p.analysis_id))
    .sort((a, b) => Number(b.topic === myTopic) - Number(a.topic === myTopic) || a.topic.localeCompare(b.topic))
  return (
    <FadeIn className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">Label data</h1>
          <p className="text-sm text-ink-muted">
            Signed in as {status.data?.annotator}. You judge every claim and passage; nothing is saved until you save it.
          </p>
        </div>
        <div className="flex gap-2">
          {status.data?.sheet_url && (
            <a
              href={status.data.sheet_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ExternalLink className="size-4" /> Open the Sheet
            </a>
          )}
          <Button variant="ghost" onClick={() => void download()} disabled={!status.data?.configured}>
            <Download className="size-4" /> Download labels CSV
          </Button>
        </div>
      </header>

      {!status.data?.configured && <Setup share={status.data?.share_with ?? ''} />}

      {pool.data && <TeamTopics pool={pool.data} />}

      {shared.length > 0 && (
        <section aria-labelledby="shared-heading" className="flex flex-col gap-2">
          <h2 id="shared-heading" className="text-sm font-semibold text-ink">
            Shared by the team
          </h2>
          <ul className="flex flex-col gap-2">
            {shared.map((p) => (
              <li key={p.analysis_id}>
                <button
                  type="button"
                  onClick={() => onOpen(p.analysis_id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{p.title}</span>
                    <span className="block text-xs text-ink-muted">
                      {p.topic}
                      {p.topic === myTopic && ' · your topic'} · {p.claims} claims
                    </span>
                  </span>
                  <span className="text-sm font-medium text-accent">Label</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready.length === 0 ? (
        <Empty
          title="No analysed papers yet"
          hint="Analyse a paper in the Researcher role first. Its claims and the passages found for them show up here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {ready.map((a) => (
            <li key={a.id} className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onOpen(a.id)}
                className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{a.title || paperName(a.file ?? a.paper)}</span>
                  <span className="block text-xs text-ink-muted">{a.claims.length} claims</span>
                </span>
                <span className="text-sm font-medium text-accent">Label</span>
              </button>
              {pool.data && (
                <TopicSelect
                  label={`Share ${a.title || paperName(a.file ?? a.paper)} with the team under a topic`}
                  value={sharedAs.get(a.id) ?? ''}
                  topics={pool.data.topics}
                  empty="Not shared"
                  disabled={assign.isPending}
                  onChange={(topic) => assign.mutate({ analysisId: a.id, topic })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </FadeIn>
  )
}
