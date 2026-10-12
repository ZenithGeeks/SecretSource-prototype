/** Who labels which topic. Anyone on the team can set anyone's, so the lead can hand out work. */

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { Card } from '../../../components/ui'
import { problem, TOPIC_INFO, useAssignTopic, type Pool } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'

export function TeamTopics({ pool }: { pool: Pool }) {
  const assign = useAssignTopic()
  const mine = pool.people.find((p) => p.name === pool.me)?.topic ?? ''
  // Open for someone who has no topic yet, so the first visit asks for it; a line otherwise.
  const [open, setOpen] = useState(!mine)

  const counts = pool.topics
    .map((topic) => ({ topic, n: pool.people.filter((p) => p.topic === topic).length }))
    .filter(({ n }) => n > 0)
  const unassigned = pool.people.filter((p) => !p.topic).length

  return (
    <Card className="p-0">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <h2 className="text-sm font-semibold text-ink">Who labels what</h2>
          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
            {counts.map(({ topic, n }) => `${topic} ${n}`).join(' · ')}
            {unassigned > 0 && `${counts.length ? ' · ' : ''}no topic ${unassigned}`}
            {mine && ` · you: ${mine}`}
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden />
        </summary>

        <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3">
          <ul className="flex flex-col divide-y divide-border-subtle">
            {pool.people.map((person) => (
              <li key={person.name} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-2">
                <span className="min-w-0 text-sm text-ink">
                  {person.name}
                  {person.name === pool.me && <span className="text-ink-muted"> (you)</span>}
                </span>
                <div role="radiogroup" aria-label={`Topic for ${person.name}`} className="flex flex-wrap gap-1">
                  {['', ...pool.topics].map((topic) => {
                    const chosen = person.topic === topic
                    const info = TOPIC_INFO[topic]
                    return (
                      <button
                        key={topic || 'none'}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        aria-label={topic || 'No topic'}
                        title={info ? `${info.name}: ${info.venues}; ${info.journal}` : 'No topic'}
                        disabled={assign.isPending}
                        onClick={() => !chosen && assign.mutate({ name: person.name, topic })}
                        className={cn(
                          'min-h-10 min-w-12 rounded-lg border px-3 text-sm transition-colors',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60',
                          chosen
                            ? 'border-accent bg-accent-soft font-semibold text-ink'
                            : 'border-border-subtle text-ink-muted hover:border-accent hover:text-ink',
                        )}
                      >
                        {topic || 'None'}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">
            {pool.topics.map((t) => (TOPIC_INFO[t] ? `${t} ${TOPIC_INFO[t].name}` : t)).join(' · ')}. Hover a topic for its
            venues.
          </p>
          {assign.isError && (
            <p role="alert" className="text-xs text-refutes">
              {problem(assign.error).title}. {problem(assign.error).hint}
            </p>
          )}
        </div>
      </details>
    </Card>
  )
}
