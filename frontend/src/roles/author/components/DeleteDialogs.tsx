/** The dialogs that ask before an Author delete, for the Library and a project's page. The
 * gateway deletes for good (there is no Author restore route), so each one says so. The draft's
 * own dialog lives with its bin in DeleteDraftButton. */

import { toast } from 'sonner'

import { ConfirmDialog } from '../../../components/library'
import { useAuthorActions } from '../../../lib/useAuthor'
import type { SavedSource } from '../../../types/draftCheck'
import { plural } from '../labels'

/** "Delete project?": says what the gateway does. The drafts and saved sources stay and move
 * to Unsorted; the .bib and the PDFs attached to its entries go with the project. */
export function DeleteProjectDialog({
  name,
  drafts,
  sources,
  entries,
  bibName,
  onCancel,
  onConfirm,
}: {
  name: string
  drafts: number
  sources: number
  entries: number
  bibName: string | null | undefined
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <ConfirmDialog title={`Delete “${name}”?`} confirmLabel="Delete project" onCancel={onCancel} onConfirm={onConfirm}>
      <p>
        Its {plural(drafts, 'draft', 'drafts')} and {plural(sources, 'saved source', 'saved sources')} move to Unsorted.
      </p>
      <p className="mt-2">
        {bibName ?? 'Its .bib'} ({plural(entries, 'entry', 'entries')}) and the PDFs attached to it are deleted, so drafts that cite
        those keys will show them as missing. This can't be undone.
      </p>
    </ConfirmDialog>
  )
}

/** "Delete “title”?" for a saved source, in the Library and on Unsorted. Only the source goes. */
export function DeleteSourceDialog({ source, onClose }: { source: SavedSource; onClose: () => void }) {
  const actions = useAuthorActions()
  return (
    <ConfirmDialog
      title={`Delete “${source.title}”?`}
      confirmLabel="Delete source"
      onCancel={onClose}
      onConfirm={async () => {
        await actions.deleteSource(source.id)
        toast.success(`${source.title} deleted`)
        onClose()
      }}
    >
      It leaves your saved sources. A .bib entry made from it stays. This cannot be undone.
    </ConfirmDialog>
  )
}
