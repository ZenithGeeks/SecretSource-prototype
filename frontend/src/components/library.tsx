/**
 * The Library frame shared by the Researcher and the Author (SCRUM-431, SCRUM-432): the page
 * header, the back link, a project card, its "⋯" menu, and the dialog shell with its confirm
 * dialog. Each role fills them with its own content: papers and claims for the Researcher, the
 * .bib, drafts and checks for the Author.
 */

import { m } from 'framer-motion'
import { ChevronRight, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { errorMessage } from '../lib/author'
import { useInFlight } from '../lib/useInFlight'
import { useMenuKeys } from '../lib/useMenuKeys'
import { cn } from '../lib/utils'
import { Button, IconButton, Input, MenuItem } from './ui'

/** A dialog's enter/exit: the scrim fades, the panel fades and settles in from slightly smaller.
 * Call sites sit inside AnimatePresence, or the exit would never play. */
const BACKDROP_MOTION = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
const PANEL_MOTION = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.15 },
}


const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'

/** The shell of every Library dialog: a scrim that closes it, Escape, and a Tab key that stays
 * inside (aria-modal alone does not stop Tab from reaching the page behind). When it closes,
 * focus goes back to what had it before it opened. */
export function Modal({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  // Read while rendering: by the time an effect runs, the dialog's autoFocus field already has focus.
  const root = useRef<HTMLDivElement>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  // After a tick: React's development StrictMode unmounts and remounts at once, which must not take focus away.
  useEffect(
    () => () => {
      setTimeout(() => {
        if (!root.current?.isConnected) opener?.focus()
      })
    },
    [opener],
  )
  // A dialog opened from a menu has nothing of its own to focus: take focus so Escape and Tab work at once.
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) root.current?.focus()
  }, [])

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') return onClose()
    if (event.key !== 'Tab') return
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
    // Shift+Tab from the dialog itself (a dialog opened from a menu starts there) would leave it too.
    const atStart = document.activeElement === stops[0] || document.activeElement === event.currentTarget
    const atEnd = document.activeElement === stops[stops.length - 1]
    if (!(event.shiftKey ? atStart : atEnd)) return
    event.preventDefault()
    stops[event.shiftKey ? stops.length - 1 : 0].focus()
  }

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={keys}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <m.div {...BACKDROP_MOTION} className="absolute inset-0 bg-ink/45" onClick={onClose} />
      {children}
    </div>
  )
}

/** A dialog's card inside Modal, 440px wide unless `className` says otherwise. With `onSubmit`
 * it is the form itself, so Enter in a field submits it. */
export function DialogPanel({
  className,
  onSubmit,
  children,
}: {
  className?: string
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  const panel = cn('relative w-[440px] max-w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-xl', className)
  if (onSubmit) {
    return (
      <m.form {...PANEL_MOTION} onSubmit={onSubmit} className={panel}>
        {children}
      </m.form>
    )
  }
  return (
    <m.div {...PANEL_MOTION} className={panel}>
      {children}
    </m.div>
  )
}

/** "Delete …?": Cancel and a red confirm, focus on Cancel so Enter right after opening deletes
 * nothing. Esc, the scrim and Cancel close it. A refused delete stays open, with the reason under
 * the text, or handed to `onError` when the role says it another way. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = 'Deleting…',
  onCancel,
  onConfirm,
  onError,
}: {
  title: string
  /** What happens, in a sentence or two. */
  children: ReactNode
  confirmLabel: string
  busyLabel?: string
  onCancel: () => void
  /** Closes the dialog itself when it is done; a throw keeps it open. */
  onConfirm: () => Promise<void>
  onError?: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const cancel = () => !busy && onCancel()
  return (
    <Modal titleId={titleId} onClose={cancel}>
      <DialogPanel className="w-[420px]">
        <h2 id={titleId} className="font-serif text-lg font-semibold break-words text-ink">
          {title}
        </h2>
        <div className="mt-2 text-sm leading-5 text-ink-muted">{children}</div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-refutes-soft px-3 py-2 text-xs text-refutes">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="border border-border-subtle" disabled={busy} onClick={cancel} autoFocus>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-refutes hover:opacity-90"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
              } catch (e) {
                if (onError) onError(e)
                else setError(errorMessage(e))
                setBusy(false)
              }
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </DialogPanel>
    </Modal>
  )
}

/** One trimmed line, as the gateway stores a name. */
const oneLine = (value: string) => value.split(/\s+/).filter(Boolean).join(' ')

/** "New project": a name, the role's own fields under it (`children`), and Create. A name
 * another project has, or a blank one when `required`, is refused here; `onCreate` resolves to
 * the gateway's refusal, shown under the name, or null (the caller then closes the dialog). One
 * submit at a time: a double click or Enter twice makes one project (SCRUM-477). */
export function NewProjectDialog({
  hint,
  placeholder,
  existing = [],
  required = false,
  maxLength,
  footer,
  onCancel,
  onCreate,
  children,
}: {
  hint: string
  placeholder: string
  /** Names already in use. */
  existing?: string[]
  required?: boolean
  maxLength?: number
  /** Left of Cancel and Create; `busy` while a create runs. */
  footer?: (busy: boolean) => ReactNode
  onCancel: () => void
  onCreate: (name: string) => Promise<string | null>
  children?: ReactNode
}) {
  const [name, setName] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const creating = useInFlight()
  const busy = creating.busy
  const titleId = useId()
  const nameId = useId()
  const errorId = useId()
  const n = oneLine(name)
  const taken = Boolean(n) && existing.some((other) => other.toLowerCase() === n.toLowerCase())
  const error = taken ? `A project called "${n}" already exists. Choose another name.` : refusal
  const cancel = () => !busy && onCancel()
  return (
    <Modal titleId={titleId} onClose={cancel}>
      <DialogPanel
        onSubmit={(event) => {
          event.preventDefault()
          if (taken || (required && !n)) return
          void creating.run(async () => setRefusal(await onCreate(n)))
        }}
      >
        <h2 id={titleId} className="font-serif text-xl font-semibold text-ink">
          New project
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">{hint}</p>

        <label htmlFor={nameId} className="mt-4 block text-[13px] font-medium text-ink">
          Project name
        </label>
        <Input
          id={nameId}
          autoFocus
          value={name}
          maxLength={maxLength}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value)
            setRefusal(null)
          }}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="mt-1.5 w-full"
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-refutes">
            {error}
          </p>
        )}

        {children}

        <div className="mt-5 flex items-center justify-end gap-2">
          {footer && <span className="mr-auto">{footer(busy)}</span>}
          <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (required && !n)}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </DialogPanel>
    </Modal>
  )
}

export type MenuButtonItem = { key: string; content: ReactNode; onSelect: () => void; className?: string }

/** A button that opens a menu of `items`. Click outside closes it; the keys are useMenuKeys'.
 * `trigger` draws the button from the props that open the menu and say so. */
export function MenuButton({
  trigger,
  items,
  label,
  className,
  menuClassName,
}: {
  trigger: (props: { onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => ReactNode
  items: MenuButtonItem[]
  label?: string
  className?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const menu = useMenuKeys(open, () => setOpen(false), root)

  return (
    <div ref={root} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur} className={cn('relative', className)}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && (
        <div role="menu" aria-label={label} className={cn('absolute right-0 z-20 mt-1 rounded-xl border border-border-subtle bg-surface p-1 shadow-card', menuClassName)}>
          {items.map((item) => (
            <MenuItem
              key={item.key}
              role="menuitem"
              onClick={() => {
                menu.returnFocus()
                setOpen(false)
                item.onSelect()
              }}
              className={cn('px-3 font-normal', item.className)}
            >
              {item.content}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  )
}

/** "⋯" on a project card or page: Rename and Delete project. */
export function ProjectMenu({ label, onRename, onDelete }: { label: string; onRename: () => void; onDelete: () => void }) {
  return (
    <MenuButton
      className="pointer-events-auto"
      menuClassName="w-44"
      trigger={(open) => (
        <IconButton {...open} aria-label={label} className="size-8 pointer-coarse:size-11">
          <MoreVertical className="size-4" />
        </IconButton>
      )}
      items={[
        { key: 'rename', content: <><Pencil className="size-4" />Rename</>, onSelect: onRename },
        {
          key: 'delete',
          content: <><Trash2 className="size-4" />Delete project</>,
          onSelect: onDelete,
          className: 'text-refutes hover:bg-refutes-soft',
        },
      ]}
    />
  )
}

/** A project card. The whole card opens the project: the open button lies under the content,
 * which lets clicks through except where a child takes them back (the rename field). `title` is
 * the name, or the rename field while renaming; `menu` is hidden then. */
export function LibraryCard({
  openLabel,
  onOpen,
  askTarget,
  title,
  meta,
  bar,
  footer,
  menu,
}: {
  openLabel: string
  onOpen: () => void
  askTarget?: string
  title: ReactNode
  meta: ReactNode
  bar?: ReactNode
  footer: ReactNode
  menu?: ReactNode
}) {
  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent">
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        data-ask-target={askTarget}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-accent"
      />
      {/* Positioned, so it paints over the open button and a click on the rename field's own
          buttons reaches them; pointer-events-none lets every other click through to open. */}
      <div className="pointer-events-none relative flex flex-col gap-3">
        {title}
        <p className="text-[13px] text-ink-muted">{meta}</p>
        {bar}
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-ink-muted">{footer}</span>
          <ChevronRight className="size-4 text-accent" aria-hidden="true" />
        </div>
        {/* The card's top right corner, out over the card's 20px padding (existing utilities only:
            the CSS budget has no room for new ones). */}
        {menu && <div className="absolute top-0 -right-1.5 -my-2">{menu}</div>}
      </div>
    </div>
  )
}

/** A project card's name, clear of the "⋯" button. */
export function ProjectName({ children }: { children: ReactNode }) {
  return <p className="pr-8 font-serif text-base font-semibold break-words text-ink">{children}</p>
}

/** A Library page's header: a counts line, the title, one sentence, and the page's actions. */
export function LibraryHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {eyebrow && <p className="type-label text-accent">{eyebrow}</p>}
        {title}
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2 self-start sm:self-auto">{actions}</div>}
    </header>
  )
}

/** A Library page's h1. */
export function LibraryTitle({ children }: { children: ReactNode }) {
  return <h1 className="type-display break-words text-ink">{children}</h1>
}

/** "← Projects · name": back to the Library landing. `hover` is the role's hover treatment for
 * the link (the Author's never underlines, #721). */
export function BackLink({
  label,
  trail,
  onClick,
  askTarget,
  hover = 'hover:underline',
}: {
  label: string
  trail?: string
  onClick: () => void
  askTarget?: string
  hover?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-ask-target={askTarget}
      className="flex items-center gap-1.5 self-start rounded text-[13px] focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className={cn('font-medium text-accent', hover)}>← {label}</span>
      {trail && <span className="text-ink-muted">· {trail}</span>}
    </button>
  )
}
