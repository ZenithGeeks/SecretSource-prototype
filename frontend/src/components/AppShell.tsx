/**
 * The role shell every signed-in screen renders inside: a solid sidebar (brand, nav, a slot
 * for the role's own list, profile footer) and, beside it, a translucent sticky toolbar over
 * the scrolling content. Role-agnostic — each role passes its own nav items, so
 * researcher/writer/teacher share one layout.
 *
 * `sidebar` goes under the nav (the researcher's recent analyses); `wide` lets the shell grow
 * for a screen that shows a PDF page beside its content, and `wide="full"` drops the width cap
 * (the labeler's two PDFs side by side). `foldable` adds a button that folds the sidebar to a
 * rail of nav icons, remembered in this browser. `panel` is a drawer on the right, below
 * the toolbar (the Ask panel), and `toolbarLead` comes first among the toolbar's actions.
 *
 * Toolbar: pass `breadcrumb` (["Analyses", "group-norm-2018.pdf"], the last item is the
 * current page) to show it, and fill its right side from any screen with
 * `<ToolbarActions>...</ToolbarActions>`, which portals into the shell's toolbar. Without a
 * `breadcrumb` there is no toolbar and ToolbarActions renders nothing.
 *
 * Figma: R/Sidebar (Redesign 2026) for the sidebar, the Results screen for the toolbar.
 */

import { ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, X } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { avatarPhotoUrl } from '../lib/avatar'
import { SETTINGS_DEFAULTS, useSettings } from '../lib/settings'
import { authEnabled } from '../lib/supabase'
import { useAuth, signOut } from '../lib/useAuth'
import { cn } from '../lib/utils'
import { Brand } from './Brand'
import { RoleChip } from './RoleChip'
import { Avatar } from './settings'

type Icon = ComponentType<{ className?: string }>

const FOLDED_KEY = 'shell.sidebarFolded'
const readFolded = () => {
  try {
    return window.localStorage.getItem(FOLDED_KEY) === '1'
  } catch {
    return false
  }
}

export type NavEntry<K extends string = string> = { key: K; label: string; icon: Icon }

/** Where ToolbarActions portals to: the toolbar's right side, or null when there is no toolbar. */
const ToolbarSlot = createContext<HTMLElement | null>(null)

/** Screen actions for the shell toolbar's right side ("Open PDF", "Export"). Render it
 * anywhere inside the shell's children; it appears in the toolbar and unmounts with the screen. */
export function ToolbarActions({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlot)
  return slot ? createPortal(children, slot) : null
}

/** Avatar initials from the display name ("Alex S." -> "AS"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** The profile footer: avatar, name, role and a settings gear. The row opens an upward menu
 * (identity, role change, Settings when the role passes onOpenSettings, Sign out only when auth
 * is on — with no Supabase configured signOut is a no-op). The gear opens Settings directly.
 * `active` highlights the row while its Settings screen is showing. */
function ProfileMenu({
  role,
  roleIcon,
  onChangeRole,
  onOpenSettings,
  active,
}: {
  role: string
  roleIcon: Icon
  onChangeRole?: () => void
  onOpenSettings?: () => void
  active?: boolean
}) {
  const { displayName, avatarUrl } = useSettings()
  const { session } = useAuth()
  // A display name changed in Settings wins. Until then, the signed-in identity: full_name is
  // set on sign-up (Auth.tsx) and by Google, while the settings default is shared by every
  // account. The email is always the session's: that is who is actually signed in.
  const metaName = session?.user?.user_metadata?.full_name as string | undefined
  const email = session?.user?.email ?? 'Signed in locally'
  const chosenName = displayName === SETTINGS_DEFAULTS.displayName ? '' : displayName.trim()
  // A signed-in account with no name of its own shows its address, never the shared default.
  // Without a session (no Supabase configured) the default name is all there is.
  const name = chosenName || metaName?.trim() || session?.user?.email || displayName.trim() || 'Your account'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Escape closes the menu without bubbling to AppShell's own handler (which would close the
    // whole mobile drawer instead).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const lit = open || active
  return (
    <div ref={ref} className="relative">
      <div
        className={cn(
          'flex items-center gap-1 rounded-[10px] transition-colors',
          lit ? 'bg-accent-soft' : 'hover:bg-accent-soft/60',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border p-2 text-left',
            lit ? 'border-accent' : 'border-transparent',
          )}
        >
          <Avatar initials={initials(name).slice(0, 1)} photoUrl={avatarPhotoUrl(avatarUrl)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] leading-[18px] font-medium text-ink">{name}</span>
            <span className="truncate text-xs leading-4 text-ink-muted">{role}</span>
          </span>
        </button>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink"
          >
            <SettingsIcon className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Rendered after the button so Tab reaches Settings/Sign out; bottom-full keeps it above. */}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl"
        >
          <div className="min-w-0 px-2 py-2">
            <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
            <p className="truncate text-[11px] text-ink-muted">{email}</p>
          </div>
          <div className="flex items-center gap-2 px-2 pb-2">
            <RoleChip role={role} icon={roleIcon} />
            <button type="button" onClick={onChangeRole} className="py-1 text-xs text-accent hover:underline">
              change
            </button>
          </div>
          <div className="my-1 h-px bg-border-subtle" />
          {onOpenSettings && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-ink hover:bg-accent-soft"
            >
              <SettingsIcon className="size-4" />
              Settings
            </button>
          )}
          {authEnabled && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-refutes hover:bg-refutes-soft"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** "Analyses > group-norm-2018.pdf": the last item is the current page. */
function Breadcrumb({ items }: { items: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-2 text-[13px] text-ink-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${i}-${item}`} className="flex min-w-0 items-center gap-2">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
              <span aria-current={last ? 'page' : undefined} className={cn('truncate', last && 'font-medium text-ink')}>
                {item}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function AppShell<K extends string>({
  nav,
  active,
  onNavigate,
  role,
  roleIcon: RoleIcon,
  onChangeRole,
  onOpenSettings,
  settingsActive = false,
  showProfileMenu = true,
  sidebar,
  breadcrumb,
  wide = false,
  foldable = false,
  notifications,
  panel,
  toolbarLead,
  children,
}: {
  nav: NavEntry<K>[]
  active: K | null
  onNavigate: (key: K) => void
  role: string
  roleIcon: Icon
  onChangeRole?: () => void
  onOpenSettings?: () => void
  /** True while the role's Settings screen (opened from the profile menu) is showing, so the
   * profile button gets the active highlight — Settings has no nav item to light. */
  settingsActive?: boolean
  showProfileMenu?: boolean
  sidebar?: ReactNode
  /** Shows the sticky toolbar with this trail on its left (last item = current page). */
  breadcrumb?: string[]
  wide?: boolean | 'full'
  foldable?: boolean
  /** A button next to the brand (the labeler's bell). It shows on the phone top bar and in the
   * folded rail too, so it is rendered once per place. */
  notifications?: ReactNode
  panel?: ReactNode
  toolbarLead?: ReactNode
  children: ReactNode
}) {
  // Below the lg breakpoint the sidebar would leave a phone almost no room, so it moves into
  // a drawer opened from a top bar.
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null)
  const [foldedChoice, setFoldedChoice] = useState(readFolded)
  const folded = foldable && foldedChoice
  const fold = (next: boolean) => {
    setFoldedChoice(next)
    try {
      window.localStorage.setItem(FOLDED_KEY, next ? '1' : '0')
    } catch {
      // the choice just is not remembered
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const navigate = (key: K) => {
    setMenuOpen(false)
    onNavigate(key)
  }

  const sidebarContent = (
    <>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {nav.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate(key)}
            aria-current={active === key ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13px] leading-[18px] font-medium lg:py-[7px]',
              active === key ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-accent-soft/60',
            )}
          >
            <Icon className={cn('size-4', active !== key && 'text-ink-muted')} />
            {label}
          </button>
        ))}
      </nav>

      {/* Opening an analysis from the drawer closes it, so the analysis is not left covered.
          Other clicks, like deleting one, keep the drawer open. */}
      <div
        onClick={(event) => {
          if ((event.target as Element).closest('[data-closes-menu]')) setMenuOpen(false)
        }}
      >
        {sidebar}
      </div>

      {showProfileMenu && (
        <div className="mt-auto">
          <ProfileMenu
            role={role}
            roleIcon={RoleIcon}
            onChangeRole={onChangeRole}
            active={settingsActive}
            onOpenSettings={
              onOpenSettings &&
              (() => {
                setMenuOpen(false)
                onOpenSettings()
              })
            }
          />
        </div>
      )}
    </>
  )

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-2 sm:px-6 lg:hidden">
        <Brand compact />
        <div className="flex items-center gap-1">
          {notifications}
          <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open the menu"
          aria-expanded={menuOpen}
          className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-accent-soft"
        >
          <Menu className="size-5" />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/45" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand compact />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close the menu"
                className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-accent-soft"
              >
                <X className="size-5" />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Solid (not translucent) and viewport-tall, so the profile footer stays pinned to the
          bottom of the screen, not the bottom of a long page. Folded, it keeps only the nav
          icons: the profile menu and the `sidebar` slot come back when it is opened. */}
      <aside
        aria-label="Sidebar"
        data-folded={folded || undefined}
        className={cn(
          'hidden shrink-0 flex-col border-r border-border-subtle bg-surface pt-[18px] lg:sticky lg:top-0 lg:flex lg:h-screen',
          folded ? 'w-14 items-center gap-2' : 'w-[248px] gap-[18px] overflow-y-auto px-3 pb-3.5',
        )}
      >
        <div className={cn('flex items-center', folded ? 'flex-col gap-2' : 'gap-0.5 px-2')}>
          {!folded && (
            <div className="mr-auto">
              <Brand compact />
            </div>
          )}
          {/* One button for both states, so keyboard focus stays on it after a click. */}
          {foldable && (
            <button
              type="button"
              onClick={() => fold(!folded)}
              aria-label={folded ? 'Open the sidebar' : 'Fold the sidebar'}
              aria-expanded={!folded}
              title={folded ? 'Open the sidebar' : 'Fold the sidebar'}
              className={cn(
                'flex items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink',
                'focus-visible:outline-2 focus-visible:outline-accent',
                folded ? 'size-10' : 'size-8',
              )}
            >
              {folded ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          )}
          {notifications}
        </div>
        {folded ? (
          <nav aria-label="Main" className="flex flex-col gap-0.5">
            {nav.map(({ key, label, icon: NavIcon }) => (
              <button
                key={key}
                type="button"
                onClick={() => navigate(key)}
                aria-label={label}
                title={label}
                aria-current={active === key ? 'page' : undefined}
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent',
                  active === key ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-accent-soft/60',
                )}
              >
                <NavIcon className="size-4" />
              </button>
            ))}
          </nav>
        ) : (
          sidebarContent
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {breadcrumb && (
          // Translucent so the content scrolls under it, blurred. Under the phone top bar it
          // sticks just below it (the bar is 3.75rem tall).
          <div className="sticky top-[3.75rem] z-20 flex min-h-[52px] items-center justify-between gap-4 border-b border-border-subtle bg-canvas/70 px-4 backdrop-blur-md sm:px-6 lg:top-0 lg:px-8">
            <Breadcrumb items={breadcrumb} />
            <div className="flex shrink-0 items-center gap-1">
              {toolbarLead}
              <div ref={setActionsEl} className="flex items-center gap-1" />
            </div>
          </div>
        )}
        <ToolbarSlot.Provider value={breadcrumb ? actionsEl : null}>
          <div className="flex min-w-0 flex-1">
            <main
              className={cn(
                'mx-auto flex w-full min-w-0 flex-1 flex-col gap-5 px-4 py-6 transition-[max-width] duration-200 sm:px-6 lg:px-8',
                wide === 'full' ? 'max-w-none' : wide ? 'max-w-[110rem]' : 'max-w-6xl',
              )}
            >
              {children}
            </main>
            {/* Sticks under the 52px toolbar and stays as tall as the window while the page scrolls.
                On a phone the panel itself covers the screen. */}
            {panel && (
              <div className="lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:w-[400px] lg:shrink-0">{panel}</div>
            )}
          </div>
        </ToolbarSlot.Provider>
      </div>
    </div>
  )
}
