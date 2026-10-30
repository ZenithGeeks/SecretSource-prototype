/** Deleting a draft from a drafts list (Home's "Your drafts", a project's drafts): the bin on
 * its row, and the dialog that asks first. The gateway deletes the draft with its files and
 * finished checks; projects, .bib files and saved sources are not touched. */

import { Trash2 } from 'lucide-react'

import { IconButton } from '../../../components/ui'
import type { Draft } from '../../../types/draftCheck'
import { ConfirmDialog } from './ConfirmDialog'

export function DeleteDraftButton({ draft, onDelete }: { draft: Draft; onDelete: (draft: Draft) => void }) {
  return (
    <IconButton onClick={() => onDelete(draft)} aria-label={`Delete ${draft.title}`} title="Delete draft" className="size-7 shrink-0 text-ink-muted hover:text-refutes lg:size-7">
      <Trash2 className="size-4" />
    </IconButton>
  )
}

export function DeleteDraftDialog({ draft, onCancel, onConfirm }: { draft: Draft; onCancel: () => void; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmDialog title={`Delete “${draft.title}”?`} confirmLabel="Delete draft" onCancel={onCancel} onConfirm={onConfirm}>
      Its files and check history are deleted, along with any unsaved text this browser kept for it. Its project and .bib stay. This can't be undone.
    </ConfirmDialog>
  )
}
