/** A paper's research subject and keywords from OpenAlex, as small tags, in the Scopus results
 * and the paper list. Nothing shows for a paper OpenAlex has none for. */

import { cn } from '../../../lib/utils'

export function PaperKeywords({ subject, keywords, className }: { subject: string; keywords: string[]; className?: string }) {
  if (!subject && keywords.length === 0) return null
  return (
    <ul aria-label="Subject and keywords" className={cn('flex flex-wrap gap-1', className)}>
      {subject && (
        <li title="Subject, from OpenAlex" className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-ink">
          {subject}
        </li>
      )}
      {keywords.map((keyword) => (
        <li key={keyword} className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-ink-muted">
          {keyword}
        </li>
      ))}
    </ul>
  )
}
