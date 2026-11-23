import { ExternalLink } from 'lucide-react'

export function WebEvidenceViewer({
  title,
  url,
  locator,
  passage,
  paragraph,
  retrievedAt,
}: {
  title: string
  url: string
  locator?: string
  passage?: string
  paragraph?: number
  retrievedAt?: string
}) {
  const target = locator || url
  return (
    <section aria-label="Web source evidence" className="flex min-h-0 flex-col gap-4 overflow-auto rounded-xl border border-border-subtle bg-surface p-5">
      <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
        Web page · static text
      </div>
      <div>
        <h3 className="font-serif text-lg font-semibold text-ink">{title || 'Cited web page'}</h3>
        <a
          href={target}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex w-fit max-w-full items-center gap-1 break-all text-sm font-medium text-accent hover:underline"
        >
          Open cited page and passage <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {passage ? (
        <blockquote className="border-l-2 border-accent pl-4 text-sm leading-7 text-ink">{passage}</blockquote>
      ) : (
        <p className="text-sm text-ink-muted">Choose a retrieved paragraph to inspect its source location.</p>
      )}
      <p className="text-xs text-ink-muted">
        {paragraph != null && `Paragraph ${paragraph}. `}The excerpt is from the page shown above. Web evidence has no PDF page number.
      </p>
      {retrievedAt && <time dateTime={retrievedAt} className="text-xs text-ink-muted">Retrieved {retrievedAt}</time>}
    </section>
  )
}
