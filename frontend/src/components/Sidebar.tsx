import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { navItems } from '../data/nav'

export interface SidebarProps {
  roleChange?: boolean
}

export function Sidebar({ roleChange = false }: SidebarProps) {
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div className="brand">
          <div className="brand__title">
            <img className="brand__logo" src="/icons/logo-mark.svg" alt="SecretSource logo mark" />
            <div className="brand__wordmark">
              <span className="brand__wordmark-part brand__wordmark-part--primary">Secret</span>
              <span className="brand__wordmark-part brand__wordmark-part--accent">Source</span>
            </div>
          </div>
          <p className="brand__tagline">Checks whether the sources a paper cites actually support what it claims.</p>
        </div>

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
            const linkClassName = `nav__link${active ? ' nav__link--active' : ''}`
            const icon = active ? item.activeIcon : item.icon

            return (
              <li className="nav__item" key={item.label}>
                {item.to ? (
                  <Link className={linkClassName} to={item.to} aria-current={active ? 'page' : undefined}>
                    <img className="nav__icon" src={icon} alt={`${item.label} icon`} />
                    <span className="nav__label">{item.label}</span>
                  </Link>
                ) : (
                  <a className={linkClassName} href="#" onClick={(event) => event.preventDefault()}>
                    <img className="nav__icon" src={icon} alt={`${item.label} icon`} />
                    <span className="nav__label">{item.label}</span>
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="sidebar__spacer"></div>

      <div className="role">
        <div className="role__chip">
          <img className="role__icon" src="/icons/icon-pen.svg" alt="Pen icon" />
          <span className="role__label">Writer</span>
        </div>
        {roleChange && (
          <a className="role__change" href="#" onClick={(event) => event.preventDefault()}>
            change
          </a>
        )}
      </div>
    </aside>
  )
}
