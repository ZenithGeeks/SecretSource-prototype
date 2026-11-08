/** A project's own actions in the Library and on its page, in the Researcher's pattern: the
 * "⋯" menu (Rename, Delete project), the inline name field Rename opens, and "+ New project"'s
 * dialog (an empty project by name, or Import a .bib or an Overleaf .zip). A project name has
 * the rules of a draft title: one trimmed line, not empty, at most MAX_TITLE characters. */

import { motion } from 'framer-motion'
import { Check, MoreVertical, Pencil, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, IconButton, Input, MenuItem, TextButton } from '../../../components/ui'
import { MAX_TITLE } from '../../../lib/draftSave'
import { cn } from '../../../lib/utils'
import { FOCUS, LINK } from '../hover'

const BACKDROP_MOTION = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
const PANEL_MOTION = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.15 },
}

/** One trimmed line, as the gateway stores it. */
const oneLine = (value: string) => value.split(/\s+/).filter(Boolean).join(' ')

/** "⋯" on a project card or page. Click outside or Esc closes it. */
export function ProjectMenu({ name, onRename, onDelete }: { name: string; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={root} className="pointer-events-auto relative">
      <IconButton onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${name}`} className="size-7 lg:size-7">
        <MoreVertical className="size-4" />
      </IconButton>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border-subtle bg-surface p-1 shadow-card">
          <MenuItem
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
            className="px-3 font-normal"
          >
            <Pencil className="size-4" />
            Rename
          </MenuItem>
          <MenuItem
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="px-3 font-normal text-refutes hover:bg-refutes-soft"
          >
            <Trash2 className="size-4" />
            Delete project
          </MenuItem>
        </div>
      )}
    </div>
  )
}

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
 * import a project used to start from. Esc or the scrim cancels. */
export function NewProjectDialog({
  onCancel,
  onCreate,
  onImport,
}: {
  onCancel: () => void
  /** Resolves to the gateway's refusal, or null once the project exists. */
  onCreate: (name: string) => Promise<string | null>
  onImport: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancel = () => !busy && onCancel()
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="new-project-title" onKeyDown={(e) => e.key === 'Escape' && cancel()} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={cancel} />
      <motion.form
        {...PANEL_MOTION}
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          const refused = await onCreate(oneLine(name))
          setBusy(false)
          if (refused) setError(refused)
        }}
        className="relative w-[440px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl"
      >
        <h2 id="new-project-title" className="font-serif text-xl font-semibold text-ink">
          New project
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">A project keeps its own .bib, PDFs and drafts. You can rename it any time.</p>

        <label htmlFor="new-project-name" className="mt-4 block text-[13px] font-medium text-ink">
          Project name
        </label>
        <Input
          id="new-project-name"
          autoFocus
          value={name}
          maxLength={MAX_TITLE}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder="Untitled project"
          className="mt-1.5 w-full"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-refutes">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <TextButton onClick={onImport} disabled={busy} className={`flex items-center gap-1.5 text-[13px] ${LINK}`}>
            <Upload className="size-3.5" aria-hidden="true" />
            Import a .bib or an Overleaf .zip
          </TextButton>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </span>
        </div>
      </motion.form>
    </div>
  )
}
