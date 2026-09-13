/**
 * The role shell every signed-in screen renders inside: brand + nav in a sidebar, and at the
 * bottom the role chip (+ change) and a profile button that opens a menu (Settings, Sign out).
 * Role-agnostic — each role passes its own nav items and chip.
 *
 * `sidebar` goes under the nav (the researcher's past analyses on History); `wide` lets the
 * shell grow for a screen that shows a PDF page beside its content. `onOpenSettings`, when
 * given, adds Settings to the profile menu (Settings lives there, not in the nav).
 *
 * Figma: NavItem (default/active), RoleChip, and the profile menu from the Components page.
 */

import { LogOut, Settings as SettingsIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { useSettings } from '../lib/settings'
import { useAuth, signOut } from '../lib/useAuth'
import { cn } from '../lib/utils'
import { Brand } from './Brand'

type Icon = ComponentType<{ className?: string }>

export type NavEntry<K extends string = string> = { key: K; label: string; icon: Icon }

/** Initials for the avatar, from the display name ("Wittawat S." → "WS"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function ProfileMenu({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { displayName } = useSettings()
  const { session } = useAuth()
  const email = session?.user?.email ?? 'Signed in locally'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
              {initials(displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{displayName}</p>
              <p className="truncate text-[11px] text-ink-muted">{email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-border-subtle" />
          {onOpenSettings && (
            <button
              type="button"
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
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-refutes hover:bg-refutes-soft"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg border border-border-subtle px-2 py-2 text-left transition-colors hover:border-accent',
          open && 'bg-accent-soft',
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
          {initials(displayName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{displayName}</span>
        </span>
      </button>
    </div>
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
  sidebar,
  wide = false,
  children,
}: {
  nav: NavEntry<K>[]
  active: K
  onNavigate: (key: K) => void
  role: string
  roleIcon: Icon
  onChangeRole?: () => void
  onOpenSettings?: () => void
  sidebar?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto flex min-h-screen gap-8 p-6 transition-[max-width] duration-200',
        wide ? 'max-w-[110rem]' : 'max-w-6xl',
      )}
    >
      <aside className="flex w-64 shrink-0 flex-col gap-4">
        <Brand />

        <nav className="flex flex-col gap-0.5">
          {nav.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={active === key ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium',
                active === key
                  ? 'bg-accent-soft text-ink'
                  : 'text-ink-muted hover:bg-accent-soft hover:text-ink',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {sidebar}

        {/* Footer: role chip + change (role switch stays on the page), then the profile menu. */}
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
              <RoleIcon className="size-4" />
              {role}
            </span>
            <button type="button" onClick={onChangeRole} className="text-xs font-medium text-accent hover:underline">
              change
            </button>
          </div>
          <ProfileMenu onOpenSettings={onOpenSettings} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-5">{children}</main>
    </div>
  )
}
