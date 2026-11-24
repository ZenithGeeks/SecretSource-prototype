/** The ways a draft or project gets in (Redesign A1, and the Read me: "Upload .tex/.zip" and "New
 * LaTeX project" merged into New project ▾): the toolbar's menu, and the same actions on the card
 * Home shows with no drafts yet. Home renders the hidden file inputs behind them once. */

import { ChevronDown, FileText, FileUp, Library, Pen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, Card, MenuItem, TextButton } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { LINK } from '../hover'

function FileInput({
  accept,
  inputRef,
  onFile,
  label,
}: {
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File) => void
  label: string
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-label={label}
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) onFile(file)
      }}
    />
  )
}

/** The two inputs the menu and the no-drafts card click. */
export function DraftFileInputs({
  texInput,
  bibInput,
  onUpload,
  onAddBibliography,
}: {
  texInput: React.RefObject<HTMLInputElement | null>
  bibInput: React.RefObject<HTMLInputElement | null>
  onUpload: (file: File) => void
  onAddBibliography: (file: File) => void
}) {
  return (
    <>
      <FileInput accept=".tex,.zip,.bib" inputRef={texInput} onFile={onUpload} label="Upload a .tex or .zip file" />
      <FileInput accept=".bib,.bbl,.txt" inputRef={bibInput} onFile={onAddBibliography} label="Upload a .bib file" />
    </>
  )
}

/** "New project ▾". Click outside or Esc closes it. */
export function NewProjectMenu({
  onNewProject,
  onUpload,
  onWrite,
  writing = false,
  onAddBibliography,
}: {
  onNewProject: () => void
  onUpload: () => void
  onWrite: () => void
  /** "Write a draft" is creating one: the item is disabled until it exists. */
  writing?: boolean
  onAddBibliography: () => void
}) {
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

  const item = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="New project"
        data-ask-target={askTarget({ kind: 'action', id: 'new-project' })}
        className="h-8.5 gap-1.5 border border-border-subtle bg-surface px-2.5 text-ui text-ink sm:px-3"
      >
        <Pen className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">New project</span>
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-border-subtle bg-surface p-1 shadow-card">
          <MenuItem role="menuitem" onClick={item(onNewProject)} className="px-3 font-normal">
            <Pen className="size-4 text-accent" aria-hidden="true" />
            New project
          </MenuItem>
          <MenuItem role="menuitem" onClick={item(onUpload)} data-ask-target={askTarget({ kind: 'action', id: 'upload' })} className="px-3 font-normal">
            <FileUp className="size-4 text-accent" aria-hidden="true" />
            Upload .tex or .zip
          </MenuItem>
          <MenuItem role="menuitem" onClick={item(onWrite)} disabled={writing} data-ask-target={askTarget({ kind: 'action', id: 'write-draft' })} className="px-3 font-normal">
            <FileText className="size-4 text-accent" aria-hidden="true" />
            Write a draft
          </MenuItem>
          <MenuItem
            role="menuitem"
            onClick={item(onAddBibliography)}
            data-ask-target={askTarget({ kind: 'action', id: 'add-bibliography' })}
            className="px-3 font-normal"
          >
            <Library className="size-4 text-accent" aria-hidden="true" />
            Add bibliography
          </MenuItem>
        </div>
      )}
    </div>
  )
}

/** Home with no drafts yet (Redesign state/LaTeX projects empty). */
export function NoDraftsCard({
  onUpload,
  onWrite,
  writing = false,
  onAddBibliography,
}: {
  onUpload: () => void
  onWrite: () => void
  /** "Write a draft" is creating one: disabled until it exists. */
  writing?: boolean
  onAddBibliography: () => void
}) {
  return (
    <Card className="flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft">
        <Pen className="size-5 text-accent" aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold text-ink">No drafts yet</h2>
      <p className="max-w-md text-sm text-ink-muted">Upload a .tex file or an Overleaf .zip with its .bib. Every \cite gets a verdict.</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <Button onClick={onUpload} data-ask-target={askTarget({ kind: 'action', id: 'upload' })}>
          Upload .tex or .zip
        </Button>
        <TextButton onClick={onWrite} disabled={writing} className={`text-sm ${LINK}`} data-ask-target={askTarget({ kind: 'action', id: 'write-draft' })}>
          Write a draft
        </TextButton>
        <TextButton onClick={onAddBibliography} className={`text-sm ${LINK}`} data-ask-target={askTarget({ kind: 'action', id: 'add-bibliography' })}>
          Add bibliography
        </TextButton>
      </div>
    </Card>
  )
}
