import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useUser } from '../hooks'
import { navItems } from '../data/nav'
import type { Role } from '../types'
import { Brand } from './Brand'
import { NavItem } from './NavItem'
import { RoleChip } from './RoleChip'

const ROLE_CYCLE: Role[] = ['writer', 'researcher', 'teacher']

export interface SidebarProps {
  roleChange?: boolean
}

export function Sidebar({ roleChange = false }: SidebarProps) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const user = useUser()
  // null = follow the fetched user's role; set once the reader cycles it themselves.
  const [roleOverride, setRoleOverride] = useState<Role | null>(null)
  const role = roleOverride ?? (user.status === 'loaded' ? user.data.role : 'writer')

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  function cycleRole() {
    setRoleOverride(ROLE_CYCLE[(ROLE_CYCLE.indexOf(role) + 1) % ROLE_CYCLE.length])
  }

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
          {navItems.map((item) => {
            const active = item.isActive(location.pathname)
            return (
              <NavItem
                key={item.label}
                label={item.label}
                to={item.to}
                icon={active ? item.activeIcon : item.icon}
                active={active}
              />
            )
          })}
        </ul>
      </nav>

      <div className="sidebar__spacer"></div>

      <RoleChip role={role} onChange={roleChange ? cycleRole : undefined} />
    </aside>
  )
}
