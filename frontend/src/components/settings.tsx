/**
 * Shared primitives for every role's Settings modal (Figma 22, sections 22a–22f): a titled
 * Section of Rows, each row a label plus one control — Toggle, Select, or a Button/text value
 * passed as children directly.
 *
 * Row generates an id for its label and, when its single child is a bare Toggle, Select or
 * plain `<input>`, wires `aria-labelledby` onto it automatically — those otherwise have no
 * accessible name (they'd announce as "switch, checked" or "edit text" with no indication of
 * which setting it is). A Button or text value already carries its own accessible name and
 * is left alone.
 */

import type { ReactNode } from 'react'
import { cloneElement, isValidElement, useId } from 'react'

import { cn } from '../lib/utils'
import { AuthorizedImage } from './AuthorizedImage'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex w-full flex-col items-start py-2">
      <div className="flex w-full items-center py-3 pb-2.5">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      </div>
      <div className="w-full divide-y divide-border-subtle">{children}</div>
    </section>
  )
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  const labelId = useId()
  const single = Array.isArray(children) ? children : [children]
  const only = single.length === 1 ? single[0] : null
  const isBareControl =
    isValidElement<{ 'aria-labelledby'?: string }>(only) &&
    (only.type === Toggle || only.type === Select || only.type === 'input')
  const child = isBareControl ? cloneElement(only, { 'aria-labelledby': labelId }) : children

  return (
    <div className="flex w-full flex-col gap-3 border-t border-border-subtle py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-sm font-medium text-ink">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-xs leading-[18px] text-ink-muted">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">{child}</div>
    </div>
  )
}

export function Toggle({
  on,
  onChange,
  disabled = false,
  'aria-labelledby': ariaLabelledBy,
}: {
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  'aria-labelledby'?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on ? 'bg-accent' : 'bg-border-subtle',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function Select({
  value,
  options,
  onChange,
  disabled = false,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: string
  /** A plain string list when the value doubles as its own label (most selects — "APA 7th",
   * "Monday"...), or `{value, label}` pairs when the stored value is an id (e.g. a class id)
   * that needs a friendlier display label. */
  options: string[] | { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
  'aria-labelledby'?: string
}) {
  const entries = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <select
      value={value}
      disabled={disabled}
      aria-labelledby={ariaLabelledBy}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 w-[180px] rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none',
        'focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {entries.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Avatar({
  initials,
  photoUrl,
  size = 32,
}: {
  initials: string
  photoUrl?: string
  size?: number
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-accent-soft"
    >
      {photoUrl ? (
        <AuthorizedImage src={photoUrl} alt="Profile photo" className="size-full object-cover" />
      ) : (
        <span className="text-[13px] font-semibold text-accent">{initials}</span>
      )}
    </span>
  )
}
