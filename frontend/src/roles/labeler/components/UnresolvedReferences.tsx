/**
 * What the reference pane shows when no PDF opens for a claim: a card for each work the claim
 * cites that could not be read, with why and the links its reference list gave, so a labeler can
 * still look the work up. A claim that cites nothing gets the plain empty state.
 */

import { ExternalLink } from 'lucide-react'
import { useState } from 'react'

import { Empty } from '../../../components/ui'
import type { Unresolved } from '../../../lib/labeling'

export function UnresolvedReferences({
  citations,
  onUpload,
  onRetry,
  onRepair,
  uploading = false,
  retrying = false,
  repairing = false,
}: {
  citations: Unresolved[]
  onUpload?: (ref: string, file: File) => void
  onRetry?: (ref: string) => void
  onRepair?: (ref: string, replacement: { doi?: string; url?: string }) => void
  uploading?: boolean
  retrying?: boolean
  repairing?: boolean
}) {
  if (citations.length === 0) return <Empty title="No reference paper" hint="This claim cites no paper." />
  return (
    <section aria-labelledby="unresolved-title" className="flex flex-col gap-3 rounded-xl border border-dashed border-border-subtle px-6 py-8">
      <div className="text-center">
        <h3 id="unresolved-title" className="font-medium">
          Reference not found
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          This claim cites {citations.length} work{citations.length === 1 ? '' : 's'} we could not read.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {citations.map((citation, index) => (
          <li key={`${citation.ref}:${index}`} className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm">
            <p className="font-medium text-ink">
              {citation.ref && <span className="text-ink-muted">[{citation.ref}] </span>}
              {citation.label}
              {citation.year && ` (${citation.year})`}
            </p>
            <p className="mt-1 text-ink-muted">Not read: {citation.reason}</p>
            {citation.repairError && (
              <p role="status" className="mt-1 text-amber-900">
                The replacement was not used: {citation.repairError.message}. The earlier result is still available.
              </p>
            )}
            {citation.sourceOutcome?.retryable && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-ink-muted">This may be a temporary failure; retrying later may help.</p>
                {onRetry && citation.ref && (
                  <button
                    type="button"
                    className="rounded-lg border border-border-subtle px-3 py-2 font-medium text-accent hover:bg-surface-muted"
                    disabled={retrying}
                    onClick={() => onRetry(citation.ref)}
                  >
                    {retrying ? 'Retrying…' : 'Retry this reference'}
                  </button>
                )}
              </div>
            )}
            {!!citation.sourceOutcome?.attempts.length && (
              <details className="mt-2 text-ink-muted">
                <summary className="w-fit cursor-pointer font-medium">Retrieval attempts</summary>
                <ul className="mt-1 list-inside list-disc">
                  {citation.sourceOutcome.attempts.map((attempt, attemptIndex) => (
                    <li key={`${attempt.provider}:${attemptIndex}`}>
                      {attempt.provider}: {attempt.result}
                      {attempt.locator && /^https?:\/\//i.test(attempt.locator) ? (
                        <> (<a className="break-all underline" href={attempt.locator} target="_blank" rel="noreferrer">{attempt.locator}</a>)</>
                      ) : attempt.host ? ` (${attempt.host})` : null}
                      {attempt.status_code && `, HTTP ${attempt.status_code}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {citation.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex w-fit max-w-full items-center gap-1 rounded font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="truncate">{link.text}</span>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ))}
            {onUpload && citation.ref && citation.reason !== 'the paper only names it, so it was not checked' && (
              <label className="mt-2 flex w-fit cursor-pointer items-center rounded-lg border border-border-subtle px-3 py-2 font-medium text-accent hover:bg-surface-muted">
                {uploading ? 'Uploading PDF…' : 'Provide a PDF'}
                <input
                  className="sr-only"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) onUpload(citation.ref, file)
                    event.currentTarget.value = ''
                  }}
                  aria-label={`Provide a PDF for ${citation.label}`}
                />
              </label>
            )}
            {onRepair && citation.ref && citation.reason !== 'the paper only names it, so it was not checked' && (
              <RepairForm citation={citation} disabled={repairing} onRepair={onRepair} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RepairForm({
  citation,
  disabled,
  onRepair,
}: {
  citation: Unresolved
  disabled: boolean
  onRepair: (ref: string, replacement: { doi?: string; url?: string }) => void
}) {
  const initialDoi = citation.doi ?? ''
  const initialUrl = citation.url ?? ''
  const [doi, setDoi] = useState(initialDoi)
  const [url, setUrl] = useState(initialUrl)
  const replacementChanged = doi.trim() !== initialDoi || url.trim() !== initialUrl
  return (
    <form
      className="mt-3 flex flex-col gap-2 rounded-lg border border-border-subtle p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!citation.ref) return
        if (doi.trim()) onRepair(citation.ref, { doi: doi.trim() })
        else if (url.trim()) onRepair(citation.ref, { url: url.trim() })
      }}
    >
      <p className="font-medium">Correct this citation</p>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        DOI
        <input
          className="min-h-9 rounded border border-border-subtle bg-canvas px-2 text-sm text-ink"
          value={doi}
          onChange={(event) => {
            setDoi(event.currentTarget.value)
            if (event.currentTarget.value) setUrl('')
          }}
          placeholder="10.1234/example"
          aria-label={`Correct DOI for ${citation.label}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Public page or PDF URL
        <input
          className="min-h-9 rounded border border-border-subtle bg-canvas px-2 text-sm text-ink"
          value={url}
          onChange={(event) => {
            setUrl(event.currentTarget.value)
            if (event.currentTarget.value) setDoi('')
          }}
          placeholder="https://example.org/article"
          aria-label={`Correct URL for ${citation.label}`}
        />
      </label>
      <button
        type="submit"
        disabled={disabled || !replacementChanged || (!doi.trim() && !url.trim())}
        className="self-start rounded-lg border border-border-subtle px-3 py-2 font-medium text-accent enabled:hover:bg-surface-muted disabled:opacity-50"
      >
        {disabled ? 'Checking replacement…' : 'Try replacement'}
      </button>
    </form>
  )
}
