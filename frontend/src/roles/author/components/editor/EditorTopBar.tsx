/** The editor's own top bar (the screen is full-bleed, in AppShell's bare mode), Figma A2
 * 716:5104: Back, the breadcrumb Home › project › draft title (click the title to rename), the
 * save state (no version number: the check history names versions); then Save, Export, when
 * the draft was last checked, Re-check, Ask and the role chip. (No Editor / Find a source
 * tabs: Find a source was dropped, #721. No History tab: a draft's check history is on its
 * project, #712.) `exportSlot` is where the Export dropdown mounts, `askSlot` the Ask button
 * (AppShell's toolbar is not shown here).
 *
 * One row at every width, never wrapping: the left side shrinks (the title truncates, Home and
 * the project leave below `@xl`), and the right side's words leave below `@5xl` so its buttons
 * are icons, each still named by its aria-label. The breakpoints are the bar's own width (a
 * container query), not the window's: with Ask open beside the editor the bar is ~400 px
 * narrower than the window. */

import { ChevronLeft, Loader2, Pen, Save, Search } from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'

import { RoleChip } from '../../../../components/RoleChip'
import { Button, TextButton } from '../../../../components/ui'
import { MAX_TITLE } from '../../../../lib/draftSave'
import { checkedLabel, useNow } from '../../../../lib/timeAgo'
import { cn } from '../../../../lib/utils'
import { LINK } from '../../hover'
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
        className={`truncate font-medium text-ink ${LINK}`}
      >
        {title}
      </button>
    )
  }
  return (
    <span className="relative flex min-w-0 items-center">
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
        className="w-64 min-w-0 rounded border border-accent bg-canvas px-1.5 py-0.5 text-sm font-medium text-ink outline-none"
      />
      {error && (
        <span id="draft-title-error" role="alert" className="absolute top-full left-0 z-10 mt-1 whitespace-nowrap rounded bg-refutes-soft px-1.5 py-0.5 text-xs text-refutes">
          {error}
        </span>
      )}
    </span>
  )
}

/** "Checked 2 min ago" beside Re-check (Figma A2), ticking on its own so the rest of the bar does
 * not re-render with it, and only once there is a check to count from. */
function CheckedAt({ id, lastCheckedAt }: { id: string; lastCheckedAt: string | null }) {
  // A minute is the smallest step the label shows.
  const now = useNow(30_000, lastCheckedAt !== null)
  return (
    <span id={id} data-testid="checked-at" className="hidden whitespace-nowrap text-xs text-ink-muted @5xl:inline">
      {checkedLabel(lastCheckedAt, now)}
    </span>
  )
}

const CRUMB = `min-w-0 truncate text-ink-muted hover:text-ink ${LINK}`
const SEPARATOR = (
  <span className="hidden @xl:inline" aria-hidden="true">
    ›
  </span>
)

export function EditorTopBar({
  title,
  status,
  onRetry,
  onRename,
  onSave,
  saving,
  back,
  onHome,
  project,
  onRecheck,
  rechecking,
  lastCheckedAt,
  exportSlot,
  askSlot,
}: {
  title: string
  status: SaveStatus
  /** Send the refused edits again. */
  onRetry: () => void
  /** Save a new title; resolves to the gateway's refusal, or null when it took it. */
  onRename: (title: string) => Promise<string | null>
  /** Save now: write what is pending and make a version (also Ctrl/Cmd+S). */
  onSave: () => void
  saving: boolean
  /** Back to the screen the editor was opened from, named by `label`. */
  back: { label: string; onClick: () => void }
  onHome: () => void
  /** The draft's project, for the breadcrumb; none for an Unsorted draft. */
  project?: { name: string; onOpen: () => void }
  onRecheck: () => void
  rechecking: boolean
  /** When the last check finished (ISO), or null when the draft was never checked. */
  lastCheckedAt: string | null
  exportSlot: ReactNode
  askSlot?: ReactNode
}) {
  const checkedId = useId()
  return (
    <header className="@container flex items-center gap-3 border-b border-border-subtle bg-surface px-3 py-2 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="ghost" onClick={back.onClick} aria-label={`Back to ${back.label}`} title={`Back to ${back.label}`} className="shrink-0 px-2">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
          <button type="button" onClick={onHome} className={cn(CRUMB, 'hidden shrink-0 @xl:inline')}>
            Home
          </button>
          {SEPARATOR}
          {project && (
            <>
              <button type="button" onClick={project.onOpen} title={project.name} className={cn(CRUMB, 'hidden max-w-40 @xl:inline')}>
                {project.name}
              </button>
              {SEPARATOR}
            </>
          )}
          <span className="flex min-w-0" aria-current="page">
            <DraftTitle title={title} onRename={onRename} />
          </span>
        </nav>
        {/* No version number here: versions are named in the check history (#721). A narrow bar
            drops "Saved" and the like, never "Save failed — retry". */}
        <span
          data-testid="save-state"
          aria-live="polite"
          className={cn('shrink-0 items-center gap-1 whitespace-nowrap text-xs', status === 'error' ? 'flex text-refutes' : 'hidden text-ink-muted @xl:flex')}
        >
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
              <TextButton onClick={onRetry} className={LINK}>
                retry
              </TextButton>
            </>
          ) : (
            'Saved'
          )}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 @5xl:gap-3">
        <Button
          variant="ghost"
          onClick={onSave}
          disabled={saving}
          aria-busy={saving}
          aria-label="Save"
          title="Save a version (Ctrl+S or ⌘S)"
          aria-keyshortcuts="Control+S Meta+S"
          className="px-2 @5xl:px-4"
        >
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          <span className="hidden @5xl:inline">Save</span>
        </Button>
        {exportSlot}
        <CheckedAt id={checkedId} lastCheckedAt={lastCheckedAt} />
        <Button
          onClick={onRecheck}
          disabled={rechecking}
          aria-busy={rechecking}
          aria-label={rechecking ? 'Checking…' : 'Re-check'}
          // On a narrow bar only the icon shows; the hidden "Checked …" still describes it.
          aria-describedby={checkedId}
          title="Check the citations again"
          className="px-2 @5xl:px-4"
        >
          {rechecking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
          <span className="hidden @5xl:inline">{rechecking ? 'Checking…' : 'Re-check'}</span>
        </Button>
        {askSlot}
        <span className="hidden @7xl:flex">
          <RoleChip role="Author" icon={Pen} />
        </span>
      </div>
    </header>
  )
}
