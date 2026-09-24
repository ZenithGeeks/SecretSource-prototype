/** The four ways a draft gets in (Figma "quick actions — draft input"). Upload and Add
 * bibliography open a file picker; Paste LaTeX opens a fresh draft in the editor; Find a
 * source moves focus to the search box further down. */

import { FileText, FileUp, Library, Search } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useRef } from 'react'

type Icon = ComponentType<{ className?: string }>

function ActionCard({
  icon: Icon,
  title,
  hint,
  onClick,
  children,
}: {
  icon: Icon
  title: string
  hint: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent focus-visible:border-accent"
    >
      <Icon className="size-4 text-accent" aria-hidden="true" />
      <span className="text-sm font-medium text-ink">{title}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
      {children}
    </button>
  )
}

/** A hidden file input the card's click opens. Reads the file as text and hands it up. */
function FilePicker({
  accept,
  inputRef,
  onFile,
}: {
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File, text: string) => void
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const text = file.name.endsWith('.zip') ? '' : await file.text()
        onFile(file, text)
      }}
    />
  )
}

export function QuickActions({
  onUpload,
  onPaste,
  onAddBibliography,
  onFindSource,
}: {
  onUpload: (file: File, text: string) => void
  onPaste: () => void
  onAddBibliography: (file: File, text: string) => void
  onFindSource: () => void
}) {
  const texInput = useRef<HTMLInputElement>(null)
  const bibInput = useRef<HTMLInputElement>(null)

  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
      <ActionCard
        icon={FileUp}
        title="Upload .tex or .zip"
        hint="One file or a whole Overleaf project with \input and figures"
        onClick={() => texInput.current?.click()}
      />
      <FilePicker accept=".tex,.zip" inputRef={texInput} onFile={onUpload} />
      <ActionCard icon={FileText} title="Paste LaTeX" hint="Drop source straight into the editor" onClick={onPaste} />
      <ActionCard
        icon={Library}
        title="Add bibliography"
        hint=".bib, BibLaTeX, or a \bibitem list, auto-linked to \cite keys"
        onClick={() => bibInput.current?.click()}
      />
      <FilePicker accept=".bib,.bbl,.txt" inputRef={bibInput} onFile={onAddBibliography} />
      <ActionCard icon={Search} title="Find a source" hint="Search papers for any claim in your draft" onClick={onFindSource} />
    </div>
  )
}
