/** The 1-4 label for one (claim, reference paper) pair, with the reason for it. */

import { useId } from 'react'

import { emptyLabel, LEVELS, type Confidence, type LabelDraft, type Level } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

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
      className={cn('flex flex-col gap-3 rounded-lg border p-3', active ? 'border-accent' : 'border-border-subtle')}
    >
      <legend className="px-1 text-sm font-medium text-ink">How well does {title} support the claim?</legend>
      {others.length > 0 && (
        <p className="text-sm text-ink-muted">Also labeled by {others.join(', ')}. Label it yourself, without looking.</p>
      )}
      <div role="radiogroup" aria-labelledby={group} className="grid grid-cols-4 gap-1.5">
        <span id={group} className="sr-only">
          Support level for {title}
        </span>
        {LEVELS.map(({ level, name, hint }) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value.evidence === level}
            aria-label={`${level} · ${name}`}
            title={hint}
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
      <ul aria-label="What each level means" className="flex flex-col gap-1 text-sm leading-5 text-ink-muted">
        {LEVELS.map(({ level, name, hint }) => (
          <li
            key={level}
            aria-current={value.evidence === level ? 'true' : undefined}
            className={cn(value.evidence === level && 'font-medium text-ink')}
          >
            <span className="tabular-nums">{level}</span> {name} — {hint}
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {value.evidence
          ? `Level ${value.evidence}, ${LEVELS[value.evidence - 1].name}: ${LEVELS[value.evidence - 1].hint}`
          : 'Pick 1–4, or press the number key.'}
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={why} className="text-sm font-medium text-ink">
          Why this level? (the deciding fact: sample size, control, replication…)
        </label>
        <textarea
          id={why}
          value={value.rationale}
          onChange={(event) => onChange({ ...value, rationale: event.target.value })}
          rows={2}
          maxLength={2000}
          className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={sure} className="text-sm font-medium text-ink">
          How sure are you?
        </label>
        <select
          id={sure}
          value={value.confidence}
          onChange={(event) => onChange({ ...value, confidence: event.target.value as Confidence })}
          className="rounded-lg border border-border-subtle bg-canvas px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
    </fieldset>
  )
}
