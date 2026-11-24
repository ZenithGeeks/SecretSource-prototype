/** The 1-4 label for one (claim, reference paper) pair, with the reason for it.
 * One per reference: PassageList puts it after that reference's passages. */

import { useId, useState } from 'react'

import { Textarea } from '../../../components/ui'
import { emptyLabel, LEVELS, type Confidence, type LabelDraft, type Level } from '../../../lib/labeling'
import { onRadioKeys, radioTabIndex } from '../../../lib/roving'
import { cn } from '../../../lib/utils'
import { Kbd } from './ClaimDecision'
import { GuideButton } from './GuideButton'

const SURE: { value: Confidence; label: string; key: string }[] = [
  { value: 'low', label: 'Low', key: 'L' },
  { value: 'medium', label: 'Medium', key: 'M' },
  { value: 'high', label: 'High', key: 'H' },
]

// Condensed from docs/annotation-guideline.md, sections 5 to 7. Change both together.
const HOW_TO_JUDGE = [
  'Grade only what the citation is for, from the cited work’s own sentences, not its related work. Its related work is evidence only for a background claim that the cited work states.',
  '3 allows only minor gaps: a left-out detail, a usual rounding, one case of several the evidence shows, a common synonym.',
  'Any other gap is a 2: wider scope, stronger certainty (“shows” for “suggests”), a missing condition, a different entity or number.',
  '1 when no passage backs it, or it contradicts the claim: start the reason with “Contradicts:”.',
  'Between two levels, pick the lower one and say why.',
]

export function LabelForm({
  tag,
  title,
  active,
  label,
  others,
  onChange,
}: {
  /** The reference in a few words, as the paper cites it: "[7]" or "Karpukhin et al. · 2020". */
  tag: string
  /** The reference's full title, shown cut to one line under the question. */
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
  const heading = useId()
  // The level under the pointer or keyboard focus, whose rule the line under the buttons shows.
  const [pointed, setPointed] = useState<Level | null>(null)
  const ruleOf = LEVELS.find((item) => item.level === (pointed ?? value.evidence))
  // A group with a heading, not a fieldset: a legend sits on the fieldset's top border, and
  // the question was drawn across the card's edge.
  return (
    <div
      role="group"
      aria-labelledby={heading}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border p-3',
        active ? 'border-accent bg-accent-soft/40 ring-2 ring-accent' : 'border-border-subtle',
      )}
    >
      <div className="min-w-0">
        <p id={heading} className="text-sm font-medium text-ink">
          How well does {tag} support the claim?
        </p>
        {title !== tag && (
          <p title={title} className="truncate text-xs text-ink-muted">
            {title}
          </p>
        )}
      </div>
      {others.length > 0 && (
        <p className="text-sm text-ink-muted">Also labeled by {others.join(', ')}. Their levels are not shown here, so choose yours on your own.</p>
      )}
      <div role="radiogroup" aria-labelledby={group} onKeyDown={onRadioKeys} className="grid grid-cols-4 gap-1.5">
        <span id={group} className="sr-only">
          Support level for {tag}
        </span>
        {LEVELS.map(({ level, name }, index) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value.evidence === level}
            tabIndex={radioTabIndex(value.evidence === level, index, value.evidence != null)}
            aria-label={`${level} · ${name}`}
            aria-describedby={`${group}-${level}`}
            aria-keyshortcuts={active ? String(level) : undefined}
            onMouseEnter={() => setPointed(level)}
            onMouseLeave={() => setPointed(null)}
            onFocus={() => setPointed(level)}
            onBlur={() => setPointed(null)}
            // Choosing the same level again takes it back: a level may be left unset.
            onClick={() => onChange({ ...value, evidence: value.evidence === level ? null : (level as Level) })}
            className={cn(
              'flex min-h-11 flex-col items-center justify-center rounded-lg border px-1 py-1 transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              value.evidence === level
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-border-subtle bg-surface text-ink-muted hover:border-accent',
            )}
          >
            {/* The keys set the level of the reference in view only, so on its form the number is drawn as its key. */}
            <span className={cn('text-base font-semibold tabular-nums', active && 'rounded-sm border border-border-subtle bg-canvas px-1.5')}>
              {level}
            </span>
            <span className="text-xs">{name}</span>
          </button>
        ))}
      </div>
      {/* One line kept for the rule, so the form does not jump as the pointer moves. Not live:
          each button already has its rule as its description. */}
      <p className="min-h-8 text-caption text-ink-muted">
        {ruleOf ? (
          <>
            <span className="font-medium text-ink">
              {ruleOf.level} {ruleOf.name}:
            </span>{' '}
            {ruleOf.hint}
          </>
        ) : (
          'Point at a level to read what it means.'
        )}
      </p>
      {/* The full list of rules, also read out with each button. */}
      <details className="text-ui text-ink">
        <summary className="w-fit cursor-pointer text-xs font-medium text-accent">How to judge</summary>
        <ul className="mt-1 flex flex-col gap-1">
          {LEVELS.map(({ level, name, hint }) => (
            <li key={level} className="flex gap-2">
              <span className="w-5 shrink-0 font-semibold tabular-nums">{level}</span>
              {/* Only the rule is read out with the button, which already says the level and name. */}
              <span>
                <span className="font-medium">{name}.</span> <span id={`${group}-${level}`}>{hint}</span>
              </span>
            </li>
          ))}
        </ul>
        <ul className="mt-2 list-inside list-disc">
          {HOW_TO_JUDGE.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <GuideButton className="mt-2" />
      </details>
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
        <div role="radiogroup" aria-labelledby={sure} onKeyDown={onRadioKeys} className="grid grid-cols-3 gap-1.5">
          {SURE.map(({ value: sureValue, label, key }, index) => (
            <button
              key={sureValue}
              type="button"
              role="radio"
              aria-checked={value.confidence === sureValue}
              tabIndex={radioTabIndex(value.confidence === sureValue, index, Boolean(value.confidence))}
              aria-keyshortcuts={key}
              onClick={() => onChange({ ...value, confidence: value.confidence === sureValue ? null : sureValue })}
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
    </div>
  )
}
