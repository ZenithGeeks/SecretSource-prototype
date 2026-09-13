/**
 * The role shell every signed-in screen renders inside: brand + nav in a sidebar, the
 * active role chip at the bottom, content in main. Role-agnostic — each role passes its
 * own nav items and chip, so researcher/writer/teacher share one layout.
 *
 * `sidebar` goes under the nav (the researcher's past analyses on History); `wide` lets
 * the shell grow for a screen that shows a PDF page beside its content.
 *
 * Figma: NavItem (default/active) and RoleChip from the Components page.
 */

import { Menu, X } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '../lib/utils'
import { Brand } from './Brand'

type Icon = ComponentType<{ className?: string }>

export type NavEntry<K extends string = string> = { key: K; label: string; icon: Icon }

export function AppShell<K extends string>({
  nav,
  active,
  onNavigate,
  role,
  roleIcon: RoleIcon,
  onChangeRole,
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
  sidebar?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  // Below the lg breakpoint the sidebar would leave a phone almost no room, so it moves into
  // a drawer opened from a top bar.
  const [menuOpen, setMenuOpen] = useState(false)

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
      <nav className="flex flex-col gap-0.5">
        {nav.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate(key)}
            aria-current={active === key ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium lg:py-2',
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

      {/* Opening an analysis from the drawer closes it, so the analysis is not left covered.
          Other clicks, like deleting one, keep the drawer open. */}
      <div
        onClick={(event) => {
          if ((event.target as Element).closest('[data-closes-menu]')) setMenuOpen(false)
        }}
      >
        {sidebar}
      </div>

      <div className="mt-auto flex items-center gap-2 px-3">
        <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
          <RoleIcon className="size-4" />
          {role}
        </span>
        <button type="button" onClick={onChangeRole} className="py-2 text-xs text-accent hover:underline">
          change
        </button>
      </div>
    </>
  )

  return (
    <div
      className={cn(
        'mx-auto flex min-h-screen flex-col gap-4 px-4 pb-6 transition-[max-width] duration-200 sm:px-6 lg:flex-row lg:gap-8 lg:pt-6',
        wide ? 'max-w-[110rem]' : 'max-w-6xl',
      )}
    >
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between border-b border-border-subtle bg-canvas/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
        <Brand compact />
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open the menu"
          aria-expanded={menuOpen}
          className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-accent-soft"
        >
          <Menu className="size-5" />
        </button>
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

      <aside className="hidden w-64 shrink-0 flex-col gap-4 lg:flex">
        <Brand />
        {sidebarContent}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-5">{children}</main>
    </div>
  )
}
