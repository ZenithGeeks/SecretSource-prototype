/** The title row every Draft check card starts with: 14px semibold title, a 12px note or
 * action on the right (Figma "head"). */

import type { ReactNode } from 'react'
import { LINK } from '../hover'

export function CardHead({ title, aside, id }: { title: string; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 id={id} className="min-w-0 flex-1 text-sm font-semibold text-ink">
        {title}
      </h2>
      {aside && <div className="shrink-0 text-xs">{aside}</div>}
    </div>
  )
}

/** A card's inline text link ("Fix in editor", "+ New draft", "show in the paper"). */
export function TextLink({
  children,
  onClick,
  className = '',
  ...rest
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  title?: string
  disabled?: boolean
  'aria-label'?: string
  'aria-disabled'?: boolean
  'aria-haspopup'?: 'menu'
  'aria-expanded'?: boolean
  'data-ask-target'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${LINK} text-xs text-accent disabled:cursor-default disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
