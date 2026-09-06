import { useEffect, useState } from 'react'

import { Brand } from './Brand'
import { NavItem } from './NavItem'
import { RoleChip } from './RoleChip'

export interface NavEntry<K extends string = string> {
  key: K
  label: string
  icon: string
  activeIcon: string
  disabled?: boolean
}

export interface SidebarProps<K extends string = string> {
  nav: NavEntry<K>[]
  active: K
  onNavigate: (key: K) => void
  roleChange?: boolean
  onChangeRole?: () => void
}

export function Sidebar<K extends string = string>({
  nav,
  active,
  onNavigate,
  roleChange = false,
  onChangeRole,
}: SidebarProps<K>) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [active])

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <Brand />

        <button
          className="sidebar__toggle"
          type="button"
          aria-label="Toggle navigation menu"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sidebar__toggle-bar"></span>
          <span className="sidebar__toggle-bar"></span>
          <span className="sidebar__toggle-bar"></span>
        </button>
      </div>

      <nav className={`nav${open ? ' nav--open' : ''}`} id="primary-nav" aria-label="Primary">
        <ul className="nav__list">
          {nav.map((item) => {
            const isActive = item.key === active
            return (
              <NavItem
                key={item.key}
                label={item.label}
                icon={isActive ? item.activeIcon : item.icon}
                active={isActive}
                onClick={item.disabled ? undefined : () => onNavigate(item.key)}
              />
            )
          })}
        </ul>
      </nav>

      <div className="sidebar__spacer"></div>

      <RoleChip role="writer" onChange={roleChange ? onChangeRole : undefined} />
    </aside>
  )
}
