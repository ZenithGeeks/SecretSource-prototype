/** The title row every Draft check card starts with: 14px semibold title, a 12px note or
 * action on the right (Figma "head"). */

import type { ReactNode } from 'react'
import { LINK } from '../hover'

/** `tabIndex={-1}` lets a screen move focus to the title, which reads it out. */
export function CardHead({ title, aside, id, tabIndex }: { title: string; aside?: ReactNode; id?: string; tabIndex?: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 id={id} tabIndex={tabIndex} className="min-w-0 flex-1 text-sm font-semibold text-ink outline-none">
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
