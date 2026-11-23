/** The 1-4 label for one (claim, reference paper) pair, with the reason for it. */

import { useId } from 'react'

import { Textarea } from '../../../components/ui'
import { emptyLabel, LEVELS, type Confidence, type LabelDraft, type Level } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { Kbd } from './ClaimDecision'

const SURE: { value: Confidence; label: string; key: string }[] = [
  { value: 'low', label: 'Low', key: 'L' },
  { value: 'medium', label: 'Medium', key: 'M' },
  { value: 'high', label: 'High', key: 'H' },
]

export function LabelForm({
  title,
  active,
  label,
  others,
  onChange,
}: {
  title: string
  active: boolean
  label: LabelDraft | undefined
  /** People who already labeled this pair. Shown, not blocking: a second label is how agreement is measured. */
  others: string[]
  onChange: (label: LabelDraft) => void
}) {
  const value = label ?? emptyLabel()
  const group = useId()
  const why = useId()
  const sure = useId()
  return (
    <fieldset
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3',
        active ? 'border-accent bg-accent-soft/40 ring-2 ring-accent' : 'border-border-subtle',
      )}
    >
      <legend className="px-1 text-sm font-medium text-ink">How well does {title} support the claim?</legend>
      {active && <p className="text-xs font-medium text-accent">Keys 1–4 set the level here</p>}
      {others.length > 0 && (
        <p className="text-sm text-ink-muted">Also labeled by {others.join(', ')}. Label it yourself, without looking.</p>
      )}
      <div role="radiogroup" aria-labelledby={group} className="grid grid-cols-4 gap-1.5">
        <span id={group} className="sr-only">
          Support level for {title}
        </span>
        {LEVELS.map(({ level, name }) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value.evidence === level}
            aria-label={`${level} · ${name}`}
            aria-describedby={`${group}-${level}`}
            onClick={() => onChange({ ...value, evidence: level as Level })}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center rounded-lg border px-1 py-1.5 transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              value.evidence === level
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-border-subtle bg-surface text-ink-muted hover:border-accent',
            )}
          >
            <span className="text-base font-semibold tabular-nums">{level}</span>
            <span className="text-xs">{name}</span>
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-0.5 text-xs leading-4 text-ink-muted">
        {LEVELS.map(({ level, name, hint }) => (
          <li
            key={level}
            id={`${group}-${level}`}
            className={cn(value.evidence === level && 'font-medium text-ink')}
          >
            <span className="tabular-nums">{level}</span> {name} — {hint}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={why} className="text-sm font-medium text-ink">
          Why this level? (the deciding fact: sample size, control, replication…)
        </label>
        <Textarea
          id={why}
          value={value.rationale}
          onChange={(event) => onChange({ ...value, rationale: event.target.value })}
          rows={2}
          maxLength={2000}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={sure} className="text-sm font-medium text-ink">
          How sure are you?
        </span>
        <div role="radiogroup" aria-labelledby={sure} className="grid grid-cols-3 gap-1.5">
          {SURE.map(({ value: sureValue, label, key }) => (
            <button
              key={sureValue}
              type="button"
              role="radio"
              aria-checked={value.confidence === sureValue}
              aria-keyshortcuts={key}
              onClick={() => onChange({ ...value, confidence: sureValue })}
              className={cn(
                'flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                value.confidence === sureValue
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-border-subtle bg-surface text-ink-muted hover:border-accent',
              )}
            >
              {label}
              <Kbd>{key}</Kbd>
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  )
}
