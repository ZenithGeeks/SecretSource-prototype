/** The handful of primitives the app reuses. Styling lives here so screens stay about content. */

import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

import type { Standing } from '../lib/claims'
import { STANDING_LABELS } from '../lib/claims'
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
        // Canvas, not white: the dark-mode accent is a light plum that white text fails on.
        variant === 'solid' && 'bg-accent text-canvas hover:opacity-90',
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
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        colorBadges ? PILL[verdict].pill : 'text-ink',
      )}
    >
      <span
        aria-hidden="true"
        data-testid="verdict-dot"
        className={cn('size-1.5 shrink-0 rounded-full', colorBadges ? PILL[verdict].dot : 'bg-current')}
      />
      {text ?? STANDING_LABELS[verdict]}
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
