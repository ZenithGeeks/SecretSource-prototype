/** The handful of primitives the app reuses. Styling lives here so screens stay about content. */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

import { useSettings } from '../lib/settings'
import { cn } from '../lib/utils'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border-subtle bg-surface p-5', className)}>
      {children}
    </div>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' }

export function Button({ className, variant = 'solid', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'solid' && 'bg-accent text-white hover:opacity-90',
        variant === 'ghost' && 'text-ink-muted hover:bg-accent-soft hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm',
        'placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  )
}

const VERDICT_STYLES = {
  supports: 'bg-supports-soft text-supports',
  refutes: 'bg-refutes-soft text-refutes',
  insufficient: 'bg-insufficient-soft text-insufficient',
} as const

export function VerdictBadge({ verdict }: { verdict: keyof typeof VERDICT_STYLES }) {
  // The Settings "Colour the verdict badges" toggle: off shows plain text (for print/export).
  const { colorBadges } = useSettings()
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase',
        colorBadges ? VERDICT_STYLES[verdict] : 'text-ink',
      )}
    >
      {verdict}
    </span>
  )
}

/**
 * A claim's standing, in a reader's words.
 *
 * Only an actual verdict gets a colour: "not checked" and "no source cited" are absences of
 * an answer, and colouring them would make an empty result look like a finding (#37).
 */
const STANDING_STYLES = {
  refutes: 'bg-refutes-soft text-refutes',
  insufficient: 'bg-insufficient-soft text-insufficient',
  supports: 'bg-supports-soft text-supports',
  unchecked: 'bg-canvas text-ink-muted',
  uncited: 'bg-canvas text-ink-muted',
} as const

export function StandingBadge({
  standing,
  title,
}: {
  standing: keyof typeof STANDING_STYLES
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase',
        STANDING_STYLES[standing],
      )}
    >
      {STANDING_TEXT[standing]}
    </span>
  )
}

const STANDING_TEXT = {
  refutes: 'source contradicts',
  insufficient: 'source is silent',
  supports: 'source backs it',
  unchecked: 'not checked',
  uncited: 'no source cited',
} as const

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-subtle px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{hint}</p>
    </div>
  )
}
