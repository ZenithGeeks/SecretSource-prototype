export interface ToggleProps {
  active: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function Toggle({ active, onToggle, children }: ToggleProps) {
  return (
    <button
      className={`filters__chip${active ? ' filters__chip--active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={onToggle}
    >
      {children}
    </button>
  )
}
