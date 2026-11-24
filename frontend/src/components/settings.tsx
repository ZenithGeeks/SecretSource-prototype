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

import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cloneElement, isValidElement, useId } from 'react'

import { useAuthorizedUrl } from '../lib/useAuthorizedUrl'
import { cn } from '../lib/utils'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex w-full flex-col items-start">
      <div className="flex w-full items-center pb-3 pr-10">
        <h2 className="text-[22px] leading-6.5 font-semibold tracking-[-0.01em] text-ink">{title}</h2>
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
    <div className="flex w-full flex-col gap-3 border-t border-border-subtle py-3.5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-ui leading-4.5 font-medium text-ink">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-xs leading-4 text-ink-muted">{hint}</p>}
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
        on ? 'bg-accent' : 'bg-neutral',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-4.5' : 'translate-x-0.5',
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
    <span className="relative inline-flex">
    <select
      value={value}
      disabled={disabled}
      aria-labelledby={ariaLabelledBy}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 w-45 appearance-none rounded-lg border border-border-subtle bg-surface py-2 pl-3 pr-9 text-ui font-medium text-ink outline-none',
        'focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {entries.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
    </span>
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
  // Fetched with the token like AuthorizedImage, but without its failure state: a stale or
  // unreachable photo shows the initials badge, not the words "Profile photo" in a 32px circle.
  // The hook revokes the blob URL when photoUrl changes and on unmount.
  const image = useAuthorizedUrl(photoUrl)
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-accent-soft"
    >
      {image.url ? (
        <img src={image.url} alt="Profile photo" className="size-full object-cover" />
      ) : (
        <span className="text-ui font-semibold text-accent">{initials}</span>
      )}
    </span>
  )
}
