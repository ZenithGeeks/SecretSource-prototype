/** Who labels which topic. Anyone on the team can set anyone's, so the lead can hand out work. */

import { Card } from '../../../components/ui'
import { TOPIC_INFO, useAssignTopic, type Pool } from '../../../lib/labeling'
import { TopicSelect } from './TopicSelect'

export function TeamTopics({ pool }: { pool: Pool }) {
  const assign = useAssignTopic()
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink">Who labels what</h2>
      <dl className="grid gap-x-4 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
        {pool.topics.map((t) => (
          <div key={t}>
            <dt className="inline font-medium text-ink">{t}</dt>
            <dd className="inline">
              {TOPIC_INFO[t] ? ` · ${TOPIC_INFO[t].name} — ${TOPIC_INFO[t].venues}; ${TOPIC_INFO[t].journal}` : ''}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-2">
        {pool.people.map((p) => (
          <li key={p.name} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink">
              {p.name}
              {p.name === pool.me && <span className="text-ink-muted"> (you)</span>}
            </span>
            <TopicSelect
              label={`Topic for ${p.name}`}
              value={p.topic}
              topics={pool.topics}
              empty="No topic"
              disabled={assign.isPending}
              onChange={(topic) => assign.mutate({ name: p.name, topic })}
            />
          </li>
        ))}
      </ul>
      {assign.isError && <p role="alert" className="text-xs text-refutes">{assign.error.message}</p>}
    </Card>
  )
}
