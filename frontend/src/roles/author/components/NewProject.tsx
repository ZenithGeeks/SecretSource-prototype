/** The one way a project starts outside the Library: NewProjectDialog, opened from Home's "New
 * project ▾" and from "+ New" in Recent projects, and the file input behind its Import. Either way
 * the new project opens; an import says how it is going, since the dialog has closed by then.
 * The dialog can take existing drafts into the new project (MoveDraft). */

import { AnimatePresence } from 'framer-motion'
import { useRef } from 'react'

import { errorMessage } from '../../../lib/author'
import { useAuthorActions } from '../../../lib/useAuthor'
import { NewProjectWithDrafts } from './MoveDraft'

export function NewProject({
  open,
  onClose,
  onCreated,
  onNotice,
}: {
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
  onNotice: (message: string) => void
}) {
  const actions = useAuthorActions()
  const importInput = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={importInput}
        type="file"
        accept=".bib,.zip"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a .bib or an Overleaf .zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          onNotice(`Importing ${file.name}…`)
          actions
            .importProject(file)
            .then((project) => {
              onNotice(`${project.name} created from ${file.name}`)
              onCreated(project.id)
            })
            .catch((error) => onNotice(`Could not import ${file.name}: ${errorMessage(error)}`))
        }}
      />
      <AnimatePresence>
        {open && (
          <NewProjectWithDrafts
            onCancel={onClose}
            onCreated={(projectId, notice) => {
              onClose()
              onNotice(notice)
              onCreated(projectId)
            }}
            onImport={() => {
              onClose()
              importInput.current?.click()
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
