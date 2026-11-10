/**
 * What the reference pane shows when no PDF opens for a claim: a card for each work the claim
 * cites that could not be read, with why and the links its reference list gave, so a labeler can
 * still look the work up. A claim that cites nothing gets the plain empty state.
 */

import { ExternalLink } from 'lucide-react'

import { Empty } from '../../../components/ui'
import type { Unresolved } from '../../../lib/labeling'

export function UnresolvedReferences({ citations }: { citations: Unresolved[] }) {
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
          </li>
        ))}
      </ul>
    </section>
  )
}
