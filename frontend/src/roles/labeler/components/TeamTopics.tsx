/** Who labels which topic. Anyone on the team can set anyone's, so the lead can hand out work. */

import { Card } from '../../../components/ui'
import { useAssignTopic, type Pool } from '../../../lib/labeling'
import { TopicSelect } from './TopicSelect'

export function TeamTopics({ pool }: { pool: Pool }) {
  const assign = useAssignTopic()
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink">Who labels what</h2>
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
