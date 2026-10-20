import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { LoadingScreen } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import type { WorkspaceTab } from '../../../lib/teacherSelectors'

export type StatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

const STATUS_STYLES: Record<StatusTone, string> = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-supports-soft text-supports',
  warning: 'bg-insufficient-soft text-insufficient',
  danger: 'bg-refutes-soft text-refutes',
  neutral: 'bg-canvas text-ink-muted',
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]', STATUS_STYLES[tone])}>
      {label}
    </span>
  )
}

export function InitialAvatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent', className)}>
      {initials}
    </span>
  )
}

export type BreadcrumbItem = {
  label: string
  onClick?: () => void
  href?: string
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <ChevronRight className="size-3 shrink-0 text-border-subtle" />}
          {item.onClick ? (
            <button type="button" onClick={item.onClick} className="cursor-pointer truncate rounded-sm hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {item.label}
            </button>
          ) : item.href ? (
            <a href={item.href} className="cursor-pointer truncate rounded-sm hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {item.label}
            </a>
          ) : (
            <span aria-current={index === items.length - 1 ? 'page' : undefined} className={cn('truncate', index === items.length - 1 && 'font-medium text-ink')}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function StepProgress({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((step, index) => {
        const complete = index < active
        const current = index === active
        return (
          <li key={step} className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                complete && 'border-accent bg-accent text-white',
                current && 'border-accent bg-accent-soft text-accent',
                !complete && !current && 'border-border-subtle text-ink-muted',
              )}
              aria-current={current ? 'step' : undefined}
            >
              {complete ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('hidden text-xs sm:inline', current ? 'font-semibold text-ink' : 'text-ink-muted')}>
              {step}
            </span>
            {index < steps.length - 1 && <span className="h-px w-5 bg-border-subtle sm:w-10" />}
          </li>
        )
      })}
    </ol>
  )
}

const WORKSPACE_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'classwork', label: 'Classwork' },
  { key: 'people', label: 'People' },
]

export function WorkspaceTabs({ active, onChange }: { active: WorkspaceTab; onChange: (tab: WorkspaceTab) => void }) {
  return (
    <div role="tablist" aria-label="Class workspace" className="flex min-h-11 gap-1.5 overflow-x-auto border-b border-border-subtle py-[5px]">
      {WORKSPACE_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-medium transition-colors',
            active === tab.key ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-accent-soft hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function PageHeading({ eyebrow, title, description, actions }: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-accent">{eyebrow}</p>}
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function MetricCard({ label, value, detail, tone = 'neutral' }: {
  label: string
  value: string | number
  detail?: string
  tone?: StatusTone
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
      <p className={cn('mt-2 font-serif text-2xl font-semibold', tone === 'neutral' ? 'text-ink' : STATUS_STYLES[tone].split(' ')[1])}>{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
    </div>
  )
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <LoadingScreen label={label} />
}
