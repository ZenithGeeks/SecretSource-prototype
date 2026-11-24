/**
 * What the reference pane shows when no PDF opens for a claim: a card for each work the claim
 * cites that could not be read, with why and the links its reference list gave, so a labeler can
 * still look the work up. A claim that cites nothing gets the plain empty state.
 */

import { ExternalLink } from 'lucide-react'

import { Empty } from '../../../components/ui'
import type { CitationMarker } from '../../../lib/api'
import { printedRef } from '../../../lib/claimText'
import type { Unresolved } from '../../../lib/labeling'

/** The links a card offers: the reference list's own, else a Google Scholar search for the
 * work's title, so a card is never a dead end. */
function lookups(citation: Unresolved) {
  if (citation.links.length || !citation.label) return citation.links
  return [{ text: 'Search for it on Google Scholar', href: `https://scholar.google.com/scholar?q=${encodeURIComponent(citation.label)}` }]
}

export function UnresolvedReferences({ citations, markers = [] }: { citations: Unresolved[]; markers?: CitationMarker[] }) {
  if (citations.length === 0) return <Empty title="No reference paper" hint="This claim cites no paper." />
  return (
    <section aria-labelledby="unresolved-title" className="flex flex-col gap-3 rounded-xl border border-dashed border-border-subtle px-6 py-8">
      <div className="text-center">
        {/* The same words as the claim strip's marker; each card below says why its work was not read. */}
        <h3 id="unresolved-title" className="font-medium">
          No reference to read ({citations.length} cited {citations.length === 1 ? 'work' : 'works'})
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          You can still decide whether the paper makes this claim. There are no passages to rate.
        </p>
      </div>
      <UnresolvedList citations={citations} markers={markers} />
    </section>
  )
}

/** One card per work that could not be read: why, and where to look it up. Also listed under the
 * reference picker on a claim where another of its references opens. */
export function UnresolvedList({ citations, markers = [] }: { citations: Unresolved[]; markers?: CitationMarker[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {citations.map((citation, index) => (
        <li key={`${citation.ref}:${index}`} className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm wrap-anywhere">
          <p className="font-medium text-ink">
            {/* The number the paper prints ("[7]"), never the extractor's own key ("b0"). */}
            {printedRef(citation, markers) && <span className="text-ink-muted">{printedRef(citation, markers)} </span>}
            {citation.label}
            {citation.year && ` (${citation.year})`}
          </p>
          <p className="mt-1 text-ink-muted">Not read: {citation.reason}</p>
          {citation.sourceOutcome?.retryable && (
            <p className="mt-1 text-ink-muted">This may be a temporary failure; retrying later may help.</p>
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
          {lookups(citation).map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex w-fit max-w-full items-center gap-1 rounded-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="truncate">{link.text}</span>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ))}
        </li>
      ))}
    </ul>
  )
}
