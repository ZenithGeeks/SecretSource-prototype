/**
 * The Settings modal shared by every role (Figma "Settings", 900x620 over a scrim). Left aside
 * is a Search box and the section list grouped General / Role / the viewed role's own sections,
 * then a "Preview a role" group; the right pane shows only the active section, with a footer
 * saying changes save as you go (there is no Save button: every control writes on change).
 * Modal state only — no route, no `?tab=` deep link (#: settings-rebuild-prompt).
 *
 * The role group previews another role's tabs without changing the signed-in role: picking
 * Researcher here just swaps which tab set is shown, the same way `viewingRole` does. Only the
 * Switch role button (inside Role and home) changes the real role, via `onSwitchRole`.
 */

import { CircleCheck, Search, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Role } from '../lib/roles'
import { usePreferencesSync } from '../lib/useAccountSettings'
import { cn } from '../lib/utils'
import { getSettingsTabs, ROLE_NAV } from './settingsTabs'
import type { SettingsTabDef } from './settingsTabs'

type Icon = ComponentType<{ className?: string }>

const GROUP_ORDER: SettingsTabDef['group'][] = ['general', 'role', 'viewing']

function GroupLabel({ children }: { children: string }) {
  return (
    <p role="presentation" className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted">
      {children}
    </p>
  )
}

function NavButton({
  label,
  icon: Icon,
  active,
  onClick,
  buttonRef,
}: {
  label: string
  icon?: Icon
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
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] leading-[18px] outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent',
        active ? 'bg-accent-soft font-semibold text-accent' : 'font-medium text-ink hover:bg-accent-soft',
      )}
    >
      {Icon && <Icon className="size-4" />}
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
  // One ref per settings tab button and per role button, so arrow keys can move DOM focus
  // along with the selection (roving tabindex: only the active tab is in the Tab order).
  // Role buttons are keyed `role:<id>`, so they never collide with a tab id.
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
  const viewingLabel = ROLE_NAV.find((r) => r.id === viewingRole)?.label ?? ''
  const groupLabel = (g: SettingsTabDef['group']) => (g === 'general' ? 'General' : g === 'role' ? 'Role' : viewingLabel)

  // Previewing a role re-anchors to its Account tab and drops the search: the query was
  // typed against the old role's labels (or matched only the role itself), so keeping it
  // would leave the new tab set filtered down to "No settings match".
  const previewRole = (role: Role) => {
    setViewingRole(role)
    setActiveTab('account')
    setSearch('')
  }

  // Arrow/Home/End travel for a roving-tabindex list. `keys` are the tabRefs keys in list
  // order; `select` applies the selection (a settings tab, or a role preview).
  const onTabKeyDown = (e: React.KeyboardEvent, keys: string[], index: number, select: (key: string) => void) => {
    let next: number
    if (e.key === 'ArrowDown') next = (index + 1) % keys.length
    else if (e.key === 'ArrowUp') next = (index - 1 + keys.length) % keys.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = keys.length - 1
    else return
    e.preventDefault()
    select(keys[next])
    // Selection and focus must travel together: otherwise Enter/Tab still act on the button
    // that was focused before, not the one that now looks selected.
    tabRefs.current.get(keys[next])?.focus()
  }

  const bindRef = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) tabRefs.current.set(key, node)
    else tabRefs.current.delete(key)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-ink/70" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-hidden border border-border-subtle bg-surface shadow-[0_24px_60px_-12px_rgba(0,0,0,0.22)] outline-none sm:h-[620px] sm:max-h-full sm:max-w-[900px] sm:flex-row sm:rounded-[20px]"
      >
        <aside className="flex max-h-[40vh] w-full shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border-subtle bg-canvas px-3 py-4 sm:h-full sm:max-h-none sm:w-[240px] sm:border-b-0 sm:border-r">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-9 w-full rounded-[9px] border border-border-subtle bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          {visibleTabs.length > 0 && (
            <div role="tablist" aria-label="Settings sections" className="flex flex-col gap-0.5">
              {GROUP_ORDER.map((group) => {
                const inGroup = visibleTabs.filter((t) => t.group === group)
                if (inGroup.length === 0) return null
                return (
                  <div key={group} role="presentation" className="flex flex-col gap-0.5">
                    <GroupLabel>{groupLabel(group)}</GroupLabel>
                    {inGroup.map((tab) => {
                      const i = visibleTabs.indexOf(tab)
                      return (
                        <div key={tab.id} onKeyDown={(e) => onTabKeyDown(e, visibleTabs.map((t) => t.id), i, setActiveTab)}>
                          <NavButton
                            label={tab.label}
                            active={tab.id === active?.id}
                            onClick={() => setActiveTab(tab.id)}
                            buttonRef={bindRef(tab.id)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
          {visibleRoles.length > 0 && (
            <>
              <GroupLabel>Preview a role</GroupLabel>
              <div role="tablist" aria-label="Roles" className="flex flex-col gap-0.5">
                {visibleRoles.map((role, i) => (
                  <div
                    key={role.id}
                    onKeyDown={(e) =>
                      onTabKeyDown(e, visibleRoles.map((r) => `role:${r.id}`), i, (key) => previewRole(key.slice('role:'.length) as Role))
                    }
                  >
                    <NavButton
                      label={role.label}
                      icon={role.icon}
                      active={role.id === viewingRole}
                      onClick={() => previewRole(role.id)}
                      buttonRef={bindRef(`role:${role.id}`)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 sm:px-7">
            <h1 className="sr-only">Settings</h1>
            {activeVisible ? active.content : <p className="text-sm text-ink-muted">No settings match "{search}".</p>}
          </div>
          <p className="flex shrink-0 items-center gap-1.5 px-4 py-4 text-xs leading-4 text-ink-muted sm:px-7">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-supports" />
            Changes save as you go. They apply to new checks; nothing already checked is re-run.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 flex size-8 items-center justify-center rounded-[9px] text-ink-muted outline-none hover:bg-accent-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  )
}
