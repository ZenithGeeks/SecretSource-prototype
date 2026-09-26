/** A running draft check, from its streamed stages: how many citations are planned, how many
 * are done, and which one is being read right now. */

import { Loader2 } from 'lucide-react'

import { Card } from '../../../components/ui'
import type { CheckRun } from '../../../types/draftCheck'

export function CheckProgress({ check }: { check: CheckRun }) {
  const planned = check.stages.find((s) => s.stage === 'planned')?.checks ?? check.citations?.length ?? 0
  const done = check.stages.filter((s) => s.stage === 'checked').length
  const current = [...check.stages].reverse().find((s) => s.stage === 'checking')
  const started = check.stages[0]?.at
  const last = check.stages[check.stages.length - 1]?.at
  const seconds = started && last ? Math.max(0, Math.round(last - started)) : null
  return (
    <Card className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-ink">
        <Loader2 className="size-4 animate-spin text-accent" aria-hidden="true" />
        Checking {planned ? `${Math.min(done, planned)} of ${planned} citation${planned === 1 ? '' : 's'}` : 'your draft'}…
        {seconds !== null && seconds > 0 && <span className="text-xs text-ink-muted">{seconds} s so far</span>}
      </div>
      {planned > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-border-subtle">
          <div className="h-full rounded bg-accent transition-[width]" style={{ width: `${Math.round((Math.min(done, planned) / planned) * 100)}%` }} />
        </div>
      )}
      {current?.key && (
        <p className="font-mono text-xs text-ink-muted">
          now reading \cite{'{'}
          {current.key}
          {'}'} · {current.source}
        </p>
      )}
    </Card>
  )
}
