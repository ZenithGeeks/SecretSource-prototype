/**
 * A segmented control with exclusive options: a soft track with the chosen option raised on a
 * surface chip. Used for the Claims | Papers switch and the Papers view filter (Figma: Graph).
 * It is a radio group, so exactly one option is checked and a screen reader hears that. As the
 * radio pattern asks, Tab reaches only the checked option and the arrow keys move the choice.
 */

import type { KeyboardEvent } from 'react'

import { cn } from '../../../lib/utils'

export function GraphSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { key: T; label: string }[]
  onChange: (key: T) => void
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const at = options.findIndex((option) => option.key === value)
    const next = options[(at + step + options.length) % options.length]
    onChange(next.key)
    // The newly checked button takes focus once it has re-rendered as the only tab stop.
    const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')
    radios[options.indexOf(next)].focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={move}
      className="inline-flex gap-0.5 rounded-[9px] bg-neutral-soft p-0.5"
    >
      {options.map((option) => {
        const on = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option.key)}
            className={cn(
              'rounded-lg px-3.5 py-[5px] text-[13px] leading-[18px] font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11',
              on ? 'bg-surface text-ink shadow-[0_1px_1px_rgba(31,20,36,0.04)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
