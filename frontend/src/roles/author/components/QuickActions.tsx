/** The four ways a draft gets in (Figma "quick actions — draft input"). Upload and Add
 * bibliography open a file picker; Write a draft opens a fresh draft in the editor; Find a
 * source opens the search screen. */

import { FileText, FileUp, Library, Search } from 'lucide-react'
import type { ComponentType } from 'react'
import { useRef } from 'react'

type Icon = ComponentType<{ className?: string }>

function ActionCard({ icon: Icon, title, hint, onClick }: { icon: Icon; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent focus-visible:border-accent"
    >
      <Icon className="size-4 text-accent" aria-hidden="true" />
      <span className="text-sm font-medium text-ink">{title}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
    </button>
  )
}

/** A hidden file input the card's click opens. */
function FilePicker({
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

export function QuickActions({
  onUpload,
  onWrite,
  onAddBibliography,
  onFindSource,
}: {
  onUpload: (file: File) => void
  onWrite: () => void
  onAddBibliography: (file: File) => void
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
      <FilePicker accept=".tex,.zip,.bib" inputRef={texInput} onFile={onUpload} label="Upload a .tex or .zip file" />
      <ActionCard icon={FileText} title="Write a draft" hint="Write or paste LaTeX in the editor and check it as you go" onClick={onWrite} />
      <ActionCard
        icon={Library}
        title="Add bibliography"
        hint=".bib, BibLaTeX, or a \bibitem list, auto-linked to \cite keys"
        onClick={() => bibInput.current?.click()}
      />
      <FilePicker accept=".bib,.bbl,.txt" inputRef={bibInput} onFile={onAddBibliography} label="Upload a .bib file" />
      <ActionCard icon={Search} title="Find a source" hint="Search papers for any claim in your draft" onClick={onFindSource} />
    </div>
  )
}
