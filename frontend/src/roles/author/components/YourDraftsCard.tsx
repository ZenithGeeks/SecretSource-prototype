/** "Your drafts": every draft with its version, last check and standing; the current one is
 * marked, and a row opens its draft in the editor. "+ New draft" opens an empty draft there too;
 * the "Since v2" box sums up what changed for the current draft and links to its check history
 * in the Library. */

import { FileText } from 'lucide-react'

import { Card, Empty } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { checkedLabel, editedLabel } from '../../../lib/author'
import { cn } from '../../../lib/utils'
import { statusLabel, statusTone } from '../../../lib/verdict'
import type { Draft } from '../../../types/draftCheck'
import { CardHead, TextLink } from './CardHead'
import { DeleteDraftButton } from './DeleteDraftButton'
import { FOCUS } from '../hover'

export function YourDraftsCard({
  drafts,
  currentId,
  onOpen,
  onNew,
  creating = false,
  onHistory,
  onDelete,
}: {
  drafts: Draft[]
  currentId: string
  onOpen: (id: string) => void
  onNew: () => void
  /** A new draft is being created: "+ New draft" is disabled until it exists. */
  creating?: boolean
  onHistory: (draft: Draft) => void
  /** The bin on each row: asks first (the caller's confirm dialog). */
  onDelete?: (draft: Draft) => void
}) {
  const current = drafts.find((d) => d.id === currentId)
  const delta = current?.sinceLastCheck

  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="your-drafts-title">
      <CardHead
        id="your-drafts-title"
        title="Your drafts"
        aside={
          <TextLink onClick={onNew} disabled={creating} data-ask-target={askTarget({ kind: 'action', id: 'new-draft' })}>
            + New draft
          </TextLink>
        }
      />
      {drafts.length === 0 ? (
        <Empty title="No drafts yet" hint="Upload a .tex file or paste LaTeX to start." />
      ) : (
        <ul aria-label="Drafts">
          {drafts.map((draft) => (
            <li key={draft.id} className="flex items-center gap-1 border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onOpen(draft.id)}
                aria-current={draft.id === currentId ? 'true' : undefined}
                data-ask-target={askTarget({ kind: 'draft', id: draft.id })}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-2 text-left hover:bg-accent-soft/40',
                  FOCUS,
                  draft.id === currentId && 'bg-accent-soft/60',
                )}
              >
                <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-ui font-medium text-ink">{draft.title}</span>
                  <span className="text-xs text-ink-muted">
                    v{draft.version} · {editedLabel(draft.edited ?? draft.updated)} · {draft.runningCheckId ? 'checking…' : checkedLabel(draft.lastCheckedAt)}
                  </span>
                </span>
                <span className={cn('shrink-0 whitespace-nowrap text-xs', statusTone(draft.status))}>{statusLabel(draft.status)}</span>
              </button>
              {onDelete && <DeleteDraftButton draft={draft} onDelete={onDelete} />}
            </li>
          ))}
        </ul>
      )}
      {current && (delta || current.checks > 0) && (
        <div className="flex flex-col gap-1 rounded-lg bg-canvas px-3 py-2.5">
          {delta ? (
            <>
              <p className="text-caption font-medium uppercase tracking-wide text-ink-muted">Since the previous check</p>
              <p className="text-xs text-ink">
                {delta.addedCitations >= 0 ? '+' : ''}
                {delta.addedCitations} citation{Math.abs(delta.addedCitations) === 1 ? '' : 's'} · {delta.fixedIssues} issue
                {delta.fixedIssues === 1 ? '' : 's'} fixed · {delta.newIssues} new issue{delta.newIssues === 1 ? '' : 's'}
              </p>
            </>
          ) : (
            <p className="text-xs text-ink-muted">Checked once so far.</p>
          )}
          <TextLink onClick={() => onHistory(current)} className="self-start" data-ask-target={askTarget({ kind: 'action', id: 'check-history' })}>
            View check history
          </TextLink>
        </div>
      )}
    </Card>
  )
}
