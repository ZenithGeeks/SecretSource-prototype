/** What a connected coding agent can and cannot do. The connect screen (components/ConnectAgent)
 * and Settings, Agents (components/AgentsSection) both show it. */

import { Ban, Check } from 'lucide-react'

import { cn } from '../lib/utils'

const CAN = [
  'See what is on this screen',
  'Open screens and papers',
  'Point at things with its cursor',
  'Fill in a field, after you press Apply',
  'Read your papers, claims and verdicts',
  'Start checking a paper you name',
]
const CANNOT = ['Save labels, delete or upload anything', 'Change your papers or your account']

export function AgentAbilities({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Abilities title="It can" items={CAN} allowed />
      <Abilities title="It cannot" items={CANNOT} allowed={false} />
    </div>
  )
}

function Abilities({ title, items, allowed }: { title: string; items: string[]; allowed: boolean }) {
  const Icon = allowed ? Check : Ban
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-ink">
            <Icon className={cn('mt-0.5 size-4 shrink-0', allowed ? 'text-supports' : 'text-refutes')} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
