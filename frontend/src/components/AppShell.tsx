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

import type { ComponentType, ReactNode } from 'react'

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

        <div className="mt-auto flex items-center gap-2 px-3">
          <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
            <RoleIcon className="size-4" />
            {role}
          </span>
          <button type="button" onClick={onChangeRole} className="text-xs text-accent hover:underline">
            change
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-5">{children}</main>
    </div>
  )
}
