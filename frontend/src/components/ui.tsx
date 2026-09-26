/** The handful of primitives the app reuses. Styling lives here so screens stay about content. */

import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
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

export function VerdictBadge({
  verdict,
  text,
}: {
  verdict: keyof typeof VERDICT_STYLES
  /** Shown instead of the verdict name, e.g. "contradicts the claim". */
  text?: string
}) {
  // The Settings "Colour the verdict badges" toggle: off shows plain text (for print/export).
  const { colorBadges } = useSettings()
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase',
        colorBadges ? VERDICT_STYLES[verdict] : 'text-ink',
      )}
    >
      {text ?? verdict}
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

/** A query's pending state, in place of returning null while it fetches — a blank screen reads
 * as "broken", not "loading" (#271). Fades in on mount so a fast load doesn't flash. */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-ink-muted"
    >
      <Loader2 className="size-4 animate-spin" />
      {label}
    </motion.div>
  )
}

/** Wraps a screen's loaded content so it fades and settles in, instead of popping in the
 * instant its query resolves (the same moment LoadingScreen above disappears). A screen whose
 * top-level sections used to be direct children of AppShell's `gap-5` flex column needs that
 * same class passed in here, or replacing the fragment with this one div drops the gap between
 * them. */
export function FadeIn({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
