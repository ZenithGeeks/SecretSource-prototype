import type { ReactNode } from 'react'

export interface BadgeProps {
  variant: 'refutes' | 'insufficient' | 'supports'
  children: ReactNode
}

export function Badge({ variant, children }: BadgeProps) {
  return <span className={`badge badge--${variant}`}>{children}</span>
}
