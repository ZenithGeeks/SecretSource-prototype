/** The editor's own top bar (the screen is full-bleed, in AppShell's bare mode): brand,
 * breadcrumb with the draft's title (click it to rename, Figma A2 716:5104), the version and
 * save state, Save, the Editor / Export tabs, Re-check, and the role chip. (No History tab:
 * History is the Researcher's, and a draft's check history is on its project, #712.)
 * `exportSlot` is where the Export dropdown mounts, `askSlot` the Ask button (AppShell's
 * toolbar, where it sits on the other screens, is not shown here). */

import { Loader2, Pen, Save, Search } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { Brand } from '../../../../components/Brand'
import { RoleChip } from '../../../../components/RoleChip'
import { Button, TextButton } from '../../../../components/ui'
import { MAX_TITLE } from '../../../../lib/draftSave'
import { cn } from '../../../../lib/utils'

/** Where the draft's text stands against the gateway: every edit written, an edit waiting for
 * the autosave pause, a write in flight, or the last write refused. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

/**
 * The draft's title in the breadcrumb; a click turns it into a field. Enter or leaving the
 * field saves, Escape cancels. The title is trimmed; an empty one is refused and the field
 * stays open with a message, as does one the gateway refuses.
 */
function DraftTitle({ title, onRename }: { title: string; onRename: (title: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set by Escape: a browser may fire blur as the field goes away, and that blur must not save.
  const cancelled = useRef(false)

  const start = () => {
    cancelled.current = false
    setValue(title)
    setError(null)
    setEditing(true)
  }
  const cancel = () => {
    cancelled.current = true
    setEditing(false)
    setError(null)
  }
  const commit = async (leaving: boolean) => {
    if (busy || cancelled.current) return
    const next = value.split(/\s+/).filter(Boolean).join(' ')
    if (!next) {
      // Leaving the field keeps the old title; Enter says why it cannot be empty.
      if (leaving) cancel()
      else setError('A draft needs a title')
      return
    }
    if (next === title) return cancel()
    setBusy(true)
    const refused = await onRename(next)
    setBusy(false)
    if (refused) setError(refused)
    else cancel()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        title="Rename this draft"
        aria-label={`Draft title: ${title}. Rename`}
        className="truncate rounded px-0.5 font-medium text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
      >
        {title}
      </button>
    )
  }
  return (
    <span className="relative flex items-center">
      <input
        aria-label="Draft title"
        // Opened by a click on the title, so focus goes where the person is about to type.
        autoFocus
        value={value}
        maxLength={MAX_TITLE}
        disabled={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'draft-title-error' : undefined}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit(false)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
        onBlur={() => void commit(true)}
        className="w-64 rounded border border-accent bg-canvas px-1.5 py-0.5 text-sm font-medium text-ink outline-none"
      />
      {error && (
        <span id="draft-title-error" role="alert" className="absolute top-full left-0 z-10 mt-1 whitespace-nowrap rounded bg-refutes-soft px-1.5 py-0.5 text-xs text-refutes">
          {error}
        </span>
      )}
    </span>
  )
}

export function EditorTopBar({
  title,
  version,
  status,
  onRetry,
  onRename,
  onSave,
  saving,
  onBack,
  onRecheck,
  rechecking,
  exportSlot,
  askSlot,
}: {
  title: string
  version: number
  status: SaveStatus
  /** Send the refused edits again. */
  onRetry: () => void
  /** Save a new title; resolves to the gateway's refusal, or null when it took it. */
  onRename: (title: string) => Promise<string | null>
  /** Save now: write what is pending and make a version (also Ctrl/Cmd+S). */
  onSave: () => void
  saving: boolean
  onBack: () => void
  onRecheck: () => void
  rechecking: boolean
  exportSlot: ReactNode
  askSlot?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 py-3">
        <Brand compact />
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
          <span className="text-ink-muted" aria-hidden="true">
            /
          </span>
          <button type="button" onClick={onBack} className="rounded text-ink-muted hover:text-accent hover:underline">
            Home
          </button>
          <span className="text-ink-muted" aria-hidden="true">
            /
          </span>
          <span className="min-w-0" aria-current="page">
            <DraftTitle title={title} onRename={onRename} />
          </span>
          <span data-testid="save-state" aria-live="polite" className={cn('flex items-center gap-1 whitespace-nowrap text-xs', status === 'error' ? 'text-refutes' : 'text-ink-muted')}>
            v{version} ·{' '}
            {status === 'saving' ? (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : status === 'unsaved' ? (
              'Unsaved changes'
            ) : status === 'error' ? (
              <>
                Save failed —{' '}
                <TextButton onClick={onRetry}>retry</TextButton>
              </>
            ) : (
              'Saved'
            )}
          </span>
        </nav>
      </div>
      <nav aria-label="Editor sections" className="ml-auto flex items-center gap-5">
        <span aria-current="page" className="border-b-2 border-accent px-1 pt-[19px] pb-[15px] text-[15px] font-medium text-accent">
          Editor
        </span>
        {exportSlot}
      </nav>
      <div className="flex items-center gap-3 py-3">
        <Button variant="ghost" onClick={onSave} disabled={saving} aria-busy={saving} title="Save a version (Ctrl+S or ⌘S)" aria-keyshortcuts="Control+S Meta+S">
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          Save
        </Button>
        <Button onClick={onRecheck} disabled={rechecking} aria-busy={rechecking}>
          {rechecking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
          {rechecking ? 'Checking…' : 'Re-check'}
        </Button>
        {askSlot}
        <RoleChip role="Author" icon={Pen} />
      </div>
    </header>
  )
}
