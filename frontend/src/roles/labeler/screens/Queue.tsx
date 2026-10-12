/** Papers to label: the person's finished analyses, and whether the Sheet is ready to take rows. */

import { Download, ExternalLink, TriangleAlert } from 'lucide-react'

import { Button, Card, Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { paperName } from '../../../lib/api'
import { labelingApi, useLabelStatus } from '../../../lib/labeling'
import { useAnalyses } from '../../../lib/useAnalysis'

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

  if (status.isLoading || analyses.isLoading) return <LoadingScreen />
  if (status.error)
    return <Empty title="You can't label here" hint={String(status.error.message).replace(/^\d+: /, '')} />

  const ready = (analyses.data ?? []).filter((a) => a.status === 'done' && a.claims.length > 0)
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

      {ready.length === 0 ? (
        <Empty
          title="No analysed papers yet"
          hint="Analyse a paper in the Researcher role first. Its claims and the passages found for them show up here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {ready.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpen(a.id)}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{a.title || paperName(a.file ?? a.paper)}</span>
                  <span className="block text-xs text-ink-muted">{a.claims.length} claims</span>
                </span>
                <span className="text-sm font-medium text-accent">Label</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </FadeIn>
  )
}
