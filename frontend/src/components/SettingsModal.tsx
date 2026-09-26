/**
 * The Settings modal shared by every role (Figma 22: 880×804 over a scrim). Left aside is a
 * Search box, the "Settings" tab group, and a "Roles" group; the right pane shows only the
 * active tab. Modal state only — no route, no `?tab=` deep link (#: settings-rebuild-prompt).
 *
 * The "Roles" group previews another role's tabs without changing the signed-in role: picking
 * Researcher here just swaps which tab set is shown, the same way `viewingRole` does. Only the
 * Switch role button (inside Role and home) changes the real role, via `onSwitchRole`.
 */

import { X } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Role } from '../screens/Onboarding'
import { usePreferencesSync } from '../lib/useAccountSettings'
import { cn } from '../lib/utils'
import { getSettingsTabs, ROLE_NAV } from './settingsTabs'

type Icon = ComponentType<{ className?: string }>

function NavButton({
  label,
  icon: Icon,
  active,
  onClick,
  buttonRef,
}: {
  label: string
  icon: Icon
  active: boolean
  onClick: () => void
  buttonRef?: (node: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent',
        active ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:bg-accent-soft hover:text-ink',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}

export function SettingsModal({
  open,
  onClose,
  currentRole,
  onSwitchRole,
}: {
  open: boolean
  onClose: () => void
  currentRole: Role
  onSwitchRole: () => void
}) {
  const [viewingRole, setViewingRole] = useState<Role>(currentRole)
  const [activeTab, setActiveTab] = useState('account')
  const [search, setSearch] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  // One ref per settings tab button, so arrow keys can move DOM focus along with the
  // selection (roving tabindex: only the active tab is in the Tab order).
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [wasOpen, setWasOpen] = useState(open)

  usePreferencesSync(open)

  // Re-anchor to the caller's own role and the first tab every time the modal opens. Adjusted
  // during render (React's documented pattern for "reset state when a prop changes") rather
  // than in an effect, so opening never costs an extra render.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setViewingRole(currentRole)
      setActiveTab('account')
      setSearch('')
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Focus trap: Tab/Shift+Tab cycle within the dialog instead of escaping to the page behind it.
  useEffect(() => {
    if (!open) return
    const node = dialogRef.current
    node?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const tabs = useMemo(
    () => getSettingsTabs(viewingRole, currentRole, onSwitchRole),
    [viewingRole, currentRole, onSwitchRole],
  )
  const active = tabs.find((t) => t.id === activeTab)
  const query = search.trim().toLowerCase()
  const visibleTabs = query ? tabs.filter((t) => t.label.toLowerCase().includes(query)) : tabs
  const visibleRoles = query ? ROLE_NAV.filter((r) => r.label.toLowerCase().includes(query)) : ROLE_NAV
  // A search that filters the active tab out of the nav should stop showing its (now
  // unreachable) content too, not silently leave stale settings on screen.
  const activeVisible = active && visibleTabs.some((t) => t.id === active.id)

  const onTabKeyDown = (e: React.KeyboardEvent, list: string[], index: number) => {
    let next: number
    if (e.key === 'ArrowDown') next = (index + 1) % list.length
    else if (e.key === 'ArrowUp') next = (index - 1 + list.length) % list.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    else return
    e.preventDefault()
    setActiveTab(list[next])
    // Selection and focus must travel together: otherwise Enter/Tab still act on the button
    // that was focused before, not the one that now looks selected.
    tabRefs.current.get(list[next])?.focus()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-ink/70" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-hidden border border-border-subtle bg-surface shadow-2xl outline-none sm:h-[804px] sm:max-w-[880px] sm:flex-row sm:rounded-2xl"
      >
        <aside className="flex max-h-[40vh] w-full shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border-subtle bg-canvas px-3 py-4 sm:h-full sm:max-h-none sm:w-[212px] sm:border-b-0 sm:border-r">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search settings"
            className="mb-3 h-9 w-full rounded-lg border border-border-subtle bg-canvas px-3 text-sm outline-none placeholder:text-ink-muted focus-visible:border-accent"
          />
          {visibleTabs.length > 0 && (
            <>
              <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-ink-muted">Settings</p>
              <div role="tablist" aria-label="Settings sections" className="flex flex-col gap-0.5">
                {visibleTabs.map((tab, i) => (
                  <div key={tab.id} onKeyDown={(e) => onTabKeyDown(e, visibleTabs.map((t) => t.id), i)}>
                    <NavButton
                      label={tab.label}
                      icon={tab.icon}
                      active={tab.id === active?.id}
                      onClick={() => setActiveTab(tab.id)}
                      buttonRef={(node) => {
                        if (node) tabRefs.current.set(tab.id, node)
                        else tabRefs.current.delete(tab.id)
                      }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
          {visibleRoles.length > 0 && (
            <>
              <p className="mt-4 px-3 pb-1 text-[11px] font-medium tracking-wide text-ink-muted">Roles</p>
              <div className="flex flex-col gap-0.5">
                {visibleRoles.map((role) => (
                  <NavButton
                    key={role.id}
                    label={role.label}
                    icon={role.icon}
                    active={role.id === viewingRole}
                    onClick={() => {
                      setViewingRole(role.id)
                      setActiveTab('account')
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 sm:px-8">
          <header className="flex items-start justify-between gap-4 pb-2 pt-3">
            <div>
              <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Settings</h1>
              <p className="text-sm text-ink-muted">
                Changes apply to new checks. Nothing already checked is re-run.
              </p>
            </div>
          </header>
          {activeVisible ? active.content : <p className="text-sm text-ink-muted">No settings match "{search}".</p>}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute right-4 top-4 flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-accent-soft hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
