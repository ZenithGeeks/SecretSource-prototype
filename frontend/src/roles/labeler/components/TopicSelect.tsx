/** A topic dropdown: the native select, so keyboard and screen readers work as they should. */

import { TOPIC_INFO } from '../../../lib/labeling'

export function TopicSelect({
  label,
  value,
  topics,
  empty,
  disabled,
  onChange,
}: {
  label: string
  value: string
  topics: string[]
  empty: string
  disabled?: boolean
  onChange: (topic: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 rounded-lg border border-border-subtle bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
    >
      <option value="">{empty}</option>
      {topics.map((t) => (
        <option key={t} value={t}>
          {TOPIC_INFO[t] ? `${t} · ${TOPIC_INFO[t].name}` : t}
        </option>
      ))}
    </select>
  )
}
