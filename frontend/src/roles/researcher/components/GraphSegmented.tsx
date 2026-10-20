/**
 * A segmented control with exclusive options: a soft track with the chosen option raised on a
 * surface chip. Used for the Claims | Papers switch and the Papers view filter (Figma: Graph).
 * It is a radio group, so exactly one option is checked and a screen reader hears that.
 */

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
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-[9px] bg-neutral-soft p-0.5">
      {options.map((option) => {
        const on = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.key)}
            className={cn(
              'rounded-lg px-3.5 py-[5px] text-[13px] leading-[18px] font-medium whitespace-nowrap transition-colors',
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
