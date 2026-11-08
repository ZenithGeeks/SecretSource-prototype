/** The file bar above the editor: one tab per project file, a red dot on those with open
 * issues from the last check, an amber one on a .bib with parse warnings, a muted dot on the
 * unsaved ones, and "+ file", which turns into a small name field. */

import { useState } from 'react'

import { cn } from '../../../../lib/utils'
import type { ProjectFile } from '../../../../types/draftCheck'

export function FileTabs({
  files,
  active,
  onSelect,
  onAdd,
}: {
  /** `issues`: the file's open issues (lib/verdict isOpenIssue); `problems`: a .bib's parse
   * warnings, entry by entry (lib/latexProject bibProblems). */
  files: (ProjectFile & { issues?: number; problems?: number })[]
  active: string
  onSelect: (name: string) => void
  onAdd: (name: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return setAdding(false)
    const withExt = /\.(tex|bib)$/i.test(trimmed) ? trimmed : `${trimmed}.tex`
    if (files.some((f) => f.name === withExt)) return setError(`${withExt} already exists`)
    onAdd(withExt)
    setName('')
    setError(null)
    setAdding(false)
  }

  return (
    <div className="flex items-center border-b border-border-subtle bg-canvas">
      <div role="tablist" aria-label="Project files" className="flex min-w-0 flex-1 overflow-x-auto">
        {files.map((file) => {
          const selected = file.name === active
          return (
            <button
              key={file.name}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(file.name)}
              onKeyDown={(event) => {
                const index = files.findIndex((f) => f.name === file.name)
                const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null
                if (next === null || !files[next]) return
                event.preventDefault()
                onSelect(files[next].name)
                ;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
              }}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-r border-border-subtle px-3.5 py-2 font-mono text-[12px] whitespace-nowrap',
                selected ? 'bg-surface font-medium text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {file.name}
              {/* Red is for the check's verdicts (Figma A2), so unsaved typing is the muted dot. */}
              {file.issues ? (
                <span
                  className="size-1.5 rounded-full bg-refutes"
                  role="img"
                  aria-label={`${file.issues} open issue${file.issues === 1 ? '' : 's'}`}
                  title={`${file.issues} open issue${file.issues === 1 ? '' : 's'}`}
                />
              ) : null}
              {/* A .bib's parse warnings take their own (amber) colour, as in the gutter. */}
              {file.problems ? (
                <span
                  className="size-1.5 rounded-full bg-insufficient"
                  role="img"
                  aria-label={`${file.problems} bib problem${file.problems === 1 ? '' : 's'}`}
                  title={`${file.problems} bib problem${file.problems === 1 ? '' : 's'}`}
                />
              ) : null}
              {file.dirty && <span className="size-1.5 rounded-full bg-ink-muted" role="img" aria-label="unsaved changes" title="Unsaved changes" />}
            </button>
          )
        })}
      </div>
      {adding ? (
        <form
          className="flex items-center gap-1.5 px-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <input
            autoFocus
            aria-label="New file name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'new-file-error' : undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => event.key === 'Escape' && setAdding(false)}
            placeholder="chapter.tex"
            className="w-36 rounded border border-border-subtle bg-surface px-2 py-0.5 font-mono text-xs"
          />
          {error && (
            <span id="new-file-error" className="text-xs text-refutes">
              {error}
            </span>
          )}
          <button type="submit" className="rounded px-1.5 py-0.5 text-xs text-accent hover:underline">
            Add
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="shrink-0 px-3.5 py-2 text-xs text-accent hover:underline">
          + file
        </button>
      )}
    </div>
  )
}
