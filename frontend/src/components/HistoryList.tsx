/** Past analyses. Selecting one reopens its results; deleting one removes it for good. */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'

import { api, type Analysis } from '../lib/api'
import { cn } from '../lib/utils'

function label(analysis: Analysis) {
  return analysis.file?.split(/[\\/]/).pop() ?? analysis.paper
}

export function HistoryList({
  analyses,
  selected,
  onSelect,
}: {
  analyses: Analysis[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: api.deleteAnalysis,
    onSuccess: ({ deleted }) => {
      if (deleted === selected) onSelect(null)
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
    },
  })

  if (!analyses.length) {
    return <p className="px-3 text-sm text-ink-muted">No analyses yet.</p>
  }

  return (
    <nav className="space-y-1">
      {analyses.map((analysis) => (
        <div
          key={analysis.id}
          className={cn(
            'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
            analysis.id === selected ? 'bg-accent-soft' : 'hover:bg-accent-soft',
          )}
        >
          <button
            data-closes-menu
            onClick={() => onSelect(analysis.id)}
            aria-current={analysis.id === selected ? 'true' : undefined}
            className={cn(
              'min-h-11 flex-1 truncate px-3 text-left text-sm',
              analysis.id === selected ? 'text-ink' : 'text-ink-muted',
            )}
            title={label(analysis)}
          >
            {label(analysis)}
            {analysis.status === 'running' && <span className="ml-1 text-accent">·</span>}
            {analysis.status === 'error' && <span className="ml-1 text-refutes">!</span>}
          </button>
          <button
            onClick={() => remove.mutate(analysis.id)}
            aria-label={`Delete analysis of ${label(analysis)}`}
            className="grid size-11 shrink-0 place-items-center rounded text-ink-muted transition-colors hover:text-refutes"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </nav>
  )
}
