/** The handful of primitives the app reuses. Styling lives here so screens stay about content. */

import { m } from 'framer-motion'
import { CircleAlert, Loader2 } from 'lucide-react'
import { type ButtonHTMLAttributes, type ComponentProps, type ReactNode, useEffect, useState } from 'react'

import type { Standing } from '../lib/claims'
import { STANDING_LABELS } from '../lib/claims'
import { useSettings } from '../lib/settings'
import { cn } from '../lib/utils'

/** A surface. Given `aria-labelledby` (its heading's id), it is a named region, so a screen
 * reader can list the screen's cards and jump between them. */
export function Card({ className, children, ...rest }: ComponentProps<'div'> & { children: ReactNode }) {
  const region = rest['aria-labelledby'] ? { role: 'region' as const } : {}
  return (
    <div {...region} {...rest} className={cn('rounded-xl border border-border-subtle bg-surface p-5', className)}>
      {children}
    </div>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' }

export function Button({ className, variant = 'solid', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium pointer-coarse:min-h-11',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Canvas, not white: the dark-mode accent is a light plum that white text fails on.
        variant === 'solid' && 'bg-accent text-canvas hover:opacity-90',
        variant === 'ghost' && 'text-ink-muted hover:bg-accent-soft hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

/** A square button holding one icon: 44 px on a phone, 32 px on a desktop unless className sets a size. */
export function IconButton({ className, type = 'button', ...props }: ComponentProps<'button'> & { 'aria-label': string }) {
  return (
    <button
      type={type}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors lg:size-8',
        'hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  )
}

/** A button that reads as a link: accent text, underlined on hover. The text size comes from the caller. */
export function TextButton({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={cn(
        'rounded font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

/** One row of a dropdown menu. Pass role="menuitem" when the menu is a role="menu". */
export function MenuItem({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-ink pointer-coarse:min-h-11',
        'hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

/** A row of buttons of which one is chosen, such as Ask's Answer and Do it. `label` names the group
 * for screen readers; each button says whether it is the chosen one with aria-pressed. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: readonly { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex rounded-xl border border-border-subtle p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-9 flex-1 rounded-lg px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11',
            value === option.value ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const FIELD =
  'w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent'

/** A one-line text field. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(FIELD, className)} {...props} />
}

/** A multi-line text field, styled like Input. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, className)} {...props} />
}

/**
 * The one verdict pill: a dot and words, never colour alone. Per-citation kinds are the
 * three verdicts plus the two absences, "not checked" (the source could not be read) and
 * "no citation" (nothing was cited). Only a real verdict gets a colour: colouring an absence
 * would make an empty result look like a finding (#37). Words come from STANDING_LABELS.
 */
const PILL = {
  refutes: { pill: 'bg-refutes-soft text-refutes', dot: 'bg-refutes' },
  insufficient: { pill: 'bg-insufficient-soft text-insufficient', dot: 'bg-insufficient' },
  supports: { pill: 'bg-supports-soft text-supports', dot: 'bg-supports' },
  unchecked: { pill: 'bg-neutral-soft text-ink-muted', dot: 'bg-neutral' },
  named: { pill: 'bg-neutral-soft text-ink-muted', dot: 'bg-neutral' },
  uncited: { pill: 'bg-neutral-soft text-ink-muted', dot: 'bg-neutral' },
} as const

export function VerdictBadge({
  verdict,
  text,
  title,
}: {
  verdict: Standing
  /** Replaces the standard words. Leave it off: the vocabulary is the same everywhere. */
  text?: string
  title?: string
}) {
  // The Settings "Colour the verdict badges" toggle: off shows plain text (for print/export).
  // The dot stays, in the text colour, so the pill still reads as a status.
  const { colorBadges } = useSettings()
  return (
    <span
      title={title}
      data-verdict={verdict}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        colorBadges ? PILL[verdict].pill : 'text-ink',
      )}
    >
      <span
        aria-hidden="true"
        data-testid="verdict-dot"
        className={cn('size-1.5 shrink-0 rounded-full', colorBadges ? PILL[verdict].dot : 'bg-current')}
      />
      {/* A long work title is cut with an ellipsis inside its column instead of overflowing it. */}
      <span className="truncate">{text ?? STANDING_LABELS[verdict]}</span>
    </span>
  )
}

/** A claim's standing, in a reader's words. Same pill as VerdictBadge. */
export function StandingBadge({ standing, title }: { standing: Standing; title?: string }) {
  return <VerdictBadge verdict={standing} title={title} />
}

const TONES = {
  neutral: 'border-border-subtle bg-neutral-soft text-ink-muted',
  accent: 'border-transparent bg-accent-soft text-ink',
  supports: 'border-transparent bg-supports-soft text-supports',
  refutes: 'border-transparent bg-refutes-soft text-refutes',
  insufficient: 'border-transparent bg-insufficient-soft text-insufficient',
} as const

/** A small label for a state or a tag. Put an icon or words in it: colour alone is not enough. */
export function Badge({
  tone = 'neutral',
  title,
  className,
  children,
}: {
  tone?: keyof typeof TONES
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A thin bar for "value of max". `label` names it for screen readers. */
export function Progress({ value, max, label, tone = 'accent' }: { value: number; max: number; label: string; tone?: 'accent' | 'supports' }) {
  const now = Math.min(value, max)
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-label={label}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-border-subtle"
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none',
          tone === 'supports' ? 'bg-supports' : 'bg-accent',
        )}
        style={{ width: `${max > 0 ? (now / max) * 100 : 0}%` }}
      />
    </span>
  )
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-subtle px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{hint}</p>
    </div>
  )
}

/** A query's failed state (#713), beside Empty and LoadingScreen: what failed, the error
 * the gateway gave, and Retry when the caller can try again. */
export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-refutes/40 bg-refutes-soft px-6 py-10 text-center">
      <CircleAlert className="size-5 text-refutes" aria-hidden="true" />
      <p className="font-medium text-ink">{title}</p>
      <p className="text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <Button type="button" variant="ghost" onClick={() => onRetry()} className="mt-1">
          Retry
        </Button>
      )}
    </div>
  )
}

const SLOW_LOAD_MS = 10_000

/** A query's pending state, in place of returning null while it fetches — a blank screen reads
 * as "broken", not "loading" (#271). Fades in on mount so a fast load doesn't flash. */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  const [slow, setSlow] = useState(false)
  // A load that takes this long usually means the server is struggling: say so, so the wait is not a mystery.
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <m.div
      role="status"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex min-h-[40vh] flex-col items-center justify-center gap-1 text-sm text-ink-muted"
    >
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </span>
      {slow && <span className="text-xs">This is taking longer than usual.</span>}
    </m.div>
  )
}

/** Wraps a screen's loaded content so it fades and settles in, instead of popping in the
 * instant its query resolves (the same moment LoadingScreen above disappears). A screen whose
 * top-level sections used to be direct children of AppShell's `gap-5` flex column needs that
 * same class passed in here, or replacing the fragment with this one div drops the gap between
 * them. */
export function FadeIn({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </m.div>
  )
}
