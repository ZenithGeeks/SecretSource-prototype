export interface NavItemProps {
  label: string
  icon: string
  active: boolean
  onClick?: () => void
}

/** One sidebar nav entry. `onClick` absent means the screen isn't built yet — inert link. */
export function NavItem({ label, icon, active, onClick }: NavItemProps) {
  const className = `nav__link${active ? ' nav__link--active' : ''}`

  return (
    <li className="nav__item">
      {onClick ? (
        <button type="button" className={className} onClick={onClick} aria-current={active ? 'page' : undefined}>
          <img className="nav__icon" src={icon} alt={`${label} icon`} />
          <span className="nav__label">{label}</span>
        </button>
      ) : (
        <a className={className} href="#" onClick={(event) => event.preventDefault()}>
          <img className="nav__icon" src={icon} alt={`${label} icon`} />
          <span className="nav__label">{label}</span>
        </a>
      )}
    </li>
  )
}
