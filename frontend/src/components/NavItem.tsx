import { Link } from 'react-router-dom'

export interface NavItemProps {
  label: string
  to: string | null
  icon: string
  active: boolean
}

export function NavItem({ label, to, icon, active }: NavItemProps) {
  const className = `nav__link${active ? ' nav__link--active' : ''}`

  return (
    <li className="nav__item">
      {to ? (
        <Link className={className} to={to} aria-current={active ? 'page' : undefined}>
          <img className="nav__icon" src={icon} alt={`${label} icon`} />
          <span className="nav__label">{label}</span>
        </Link>
      ) : (
        <a className={className} href="#" onClick={(event) => event.preventDefault()}>
          <img className="nav__icon" src={icon} alt={`${label} icon`} />
          <span className="nav__label">{label}</span>
        </a>
      )}
    </li>
  )
}
