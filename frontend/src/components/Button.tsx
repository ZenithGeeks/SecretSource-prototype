import type { ReactNode } from 'react'

export interface ButtonProps {
  variant: 'primary' | 'ghost'
  icon?: { src: string; alt: string }
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
}

export function Button({ variant, icon, children, onClick, type = 'button' }: ButtonProps) {
  return (
    <button className={`button button--${variant}`} type={type} onClick={onClick}>
      {icon && <img className="button__icon" src={icon.src} alt={icon.alt} />}
      <span className="button__label">{children}</span>
    </button>
  )
}
