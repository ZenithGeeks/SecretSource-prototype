import type { Role } from '../screens/Onboarding'

const ROLE_ICON: Record<Role, string> = {
  writer: '/icons/icon-pen.svg',
  researcher: '/icons/icon-search.svg',
  teacher: '/icons/icon-library.svg',
}

const ROLE_LABEL: Record<Role, string> = {
  writer: 'Writer',
  researcher: 'Researcher',
  teacher: 'Teacher',
}

export interface RoleChipProps {
  role: Role
  onChange?: () => void
}

export function RoleChip({ role, onChange }: RoleChipProps) {
  return (
    <div className="role">
      <div className="role__chip">
        <img className="role__icon" src={ROLE_ICON[role]} alt={`${ROLE_LABEL[role]} icon`} />
        <span className="role__label">{ROLE_LABEL[role]}</span>
      </div>
      {onChange && (
        <a
          className="role__change"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            onChange()
          }}
        >
          change
        </a>
      )}
    </div>
  )
}
