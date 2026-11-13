/** A project's own actions in the Library and on its page, beside the shared "⋯" menu
 * (components/library): the inline name field Rename opens, and "+ New project"'s dialog (an empty project by name, or Import a .bib or an Overleaf .zip). A project name has
 * the rules of a draft title: one trimmed line, not empty, at most MAX_TITLE characters. */

import { Check, Upload, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { NewProjectDialog as SharedNewProjectDialog } from '../../../components/library'
import { IconButton, TextButton } from '../../../components/ui'
import { MAX_TITLE } from '../../../lib/draftSave'
import { cn } from '../../../lib/utils'
import { FOCUS, LINK } from '../hover'

/** One trimmed line, as the gateway stores it. */
const oneLine = (value: string) => value.split(/\s+/).filter(Boolean).join(' ')

/** The name in edit: Enter or ✓ saves, Esc or ✕ cancels. An empty name is refused here, a name
 * the gateway refuses keeps the field open with its reason. */
export function ProjectNameField({
  name,
  onSave,
  onDone,
  className,
}: {
  name: string
  /** Resolves to the gateway's refusal, or null when it took the name. */
  onSave: (name: string) => Promise<string | null>
  onDone: () => void
  className?: string
}) {
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const next = oneLine(value)
    if (!next) return setError('A project needs a name')
    if (next === name) return onDone()
    setSaving(true)
    const refused = await onSave(next)
    setSaving(false)
    if (refused) setError(refused)
    else onDone()
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className={cn('pointer-events-auto flex flex-col gap-1', className)}
    >
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          aria-label="Project name"
          value={value}
          maxLength={MAX_TITLE}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'project-name-error' : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => event.key === 'Escape' && onDone()}
          className="w-full min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2.5 py-1.5 font-serif text-base font-semibold text-ink outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={saving}
          aria-label="Save name"
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg bg-supports-soft text-supports hover:opacity-90 disabled:opacity-50 ${FOCUS}`}
        >
          <Check className="size-4" />
        </button>
        <IconButton onClick={onDone} disabled={saving} aria-label="Cancel renaming" className="size-7 lg:size-7">
          <X className="size-4" />
        </IconButton>
      </span>
      {error && (
        <span id="project-name-error" role="alert" className="text-xs text-refutes">
          {error}
        </span>
      )}
    </form>
  )
}

/** "+ New project": an empty project by name ("Untitled project N" when left empty), or the
 * import a project used to start from. `children` go under the name (MoveDraft's "Add existing
 * drafts"). */
export function NewProjectDialog({
  onCancel,
  onCreate,
  onImport,
  children,
}: {
  onCancel: () => void
  /** Resolves to the gateway's refusal, or null once the project exists. */
  onCreate: (name: string) => Promise<string | null>
  /** None hides "Import a .bib or an Overleaf .zip". */
  onImport?: () => void
  children?: ReactNode
}) {
  return (
    <SharedNewProjectDialog
      hint="A project keeps its own .bib, PDFs and drafts. You can rename it any time."
      placeholder="Untitled project"
      maxLength={MAX_TITLE}
      onCancel={onCancel}
      onCreate={onCreate}
      footer={
        onImport &&
        ((busy) => (
          <TextButton onClick={onImport} disabled={busy} className={`flex items-center gap-1.5 text-[13px] ${LINK}`}>
            <Upload className="size-3.5" aria-hidden="true" />
            Import a .bib or an Overleaf .zip
          </TextButton>
        ))
      }
    >
      {children}
    </SharedNewProjectDialog>
  )
}
