/** Shared building blocks for the account Settings screens (writer, researcher) — settings
 * are account-scoped, not per-role, so the screens share these layout/control primitives too. */

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

import { cn } from '../lib/utils'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  )
}

/** Generates an id for its label and passes it down to a single control child as
 * `aria-labelledby`, so Toggle/Select controls announce which setting they belong to
 * instead of a bare "switch, checked" / "combo box, Balanced". */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const labelId = useId()
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <p id={labelId} className="text-sm text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">
        {isValidElement(children)
          ? cloneElement(children as ReactElement<{ 'aria-labelledby'?: string }>, { 'aria-labelledby': labelId })
          : children}
      </div>
    </div>
  )
}

export function Toggle({
  on,
  onChange,
  'aria-labelledby': ariaLabelledBy,
}: {
  on: boolean
  onChange: (on: boolean) => void
  'aria-labelledby'?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={ariaLabelledBy}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-border-subtle',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function Select({
  value,
  options,
  onChange,
  disabled,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  disabled?: boolean
  'aria-labelledby'?: string
}) {
  return (
    <select
      aria-labelledby={ariaLabelledBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded-lg border border-border-subtle bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}
