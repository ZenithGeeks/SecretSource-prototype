/** "Your drafts": every draft with its version, last check and standing; the current one is
 * marked. "+ New draft" opens an empty draft in the editor; the "Since v2" box sums up what
 * changed for the current draft and links to its check history in the Library. */

import { FileText } from 'lucide-react'

import { Card, Empty } from '../../../components/ui'
import { checkedLabel } from '../../../lib/author'
import { cn } from '../../../lib/utils'
import { statusLabel, statusTone } from '../../../lib/verdict'
import type { Draft } from '../../../types/draftCheck'
import { CardHead, TextLink } from './CardHead'

export function YourDraftsCard({
  drafts,
  currentId,
  onSelect,
  onNew,
  onHistory,
}: {
  drafts: Draft[]
  currentId: string
  onSelect: (id: string) => void
  onNew: () => void
  onHistory: (draft: Draft) => void
}) {
  const current = drafts.find((d) => d.id === currentId)
  const delta = current?.sinceLastCheck

  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="your-drafts-title">
      <CardHead id="your-drafts-title" title="Your drafts" aside={<TextLink onClick={onNew}>+ New draft</TextLink>} />
      {drafts.length === 0 ? (
        <Empty title="No drafts yet" hint="Upload a .tex file or paste LaTeX to start." />
      ) : (
        <ul aria-label="Drafts">
          {drafts.map((draft) => (
            <li key={draft.id} className="border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onSelect(draft.id)}
                aria-current={draft.id === currentId ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-1 py-2 text-left hover:bg-accent-soft/40',
                  draft.id === currentId && 'bg-accent-soft/60',
                )}
              >
                <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-ink">{draft.title}</span>
                  <span className="text-xs text-ink-muted">
                    v{draft.version} · {draft.runningCheckId ? 'checking…' : checkedLabel(draft.lastCheckedAt)}
                  </span>
                </span>
                <span className={cn('shrink-0 whitespace-nowrap text-xs', statusTone(draft.status))}>{statusLabel(draft.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && (delta || current.checks > 0) && (
        <div className="flex flex-col gap-1 rounded-lg bg-canvas px-3 py-2.5">
          {delta ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Since the previous check</p>
              <p className="text-xs text-ink">
                {delta.addedCitations >= 0 ? '+' : ''}
                {delta.addedCitations} citation{Math.abs(delta.addedCitations) === 1 ? '' : 's'} · {delta.fixedIssues} issue
                {delta.fixedIssues === 1 ? '' : 's'} fixed · {delta.newIssues} new issue{delta.newIssues === 1 ? '' : 's'}
              </p>
            </>
          ) : (
            <p className="text-xs text-ink-muted">Checked once so far.</p>
          )}
          <TextLink onClick={() => onHistory(current)} className="self-start">
            View check history
          </TextLink>
        </div>
      )}
    </Card>
  )
}
