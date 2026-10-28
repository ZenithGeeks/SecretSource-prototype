/** The editor's own top bar (the screen is full-bleed, in AppShell's bare mode): brand,
 * breadcrumb with the version and save state, the Editor / Export / History tabs, Re-check,
 * and the role chip. `exportSlot` is where the Export dropdown mounts, `askSlot` the Ask
 * button (AppShell's toolbar, where it sits on the other screens, is not shown here). */

import { Loader2, Pen, Search } from 'lucide-react'
import type { ReactNode } from 'react'

import { Brand } from '../../../../components/Brand'
import { RoleChip } from '../../../../components/RoleChip'
import { Button, TextButton } from '../../../../components/ui'
import { cn } from '../../../../lib/utils'

export type EditorTab = 'editor' | 'history'

/** Where the draft's text stands against the gateway: every edit written, a write pending or
 * in flight, or the last write refused. */
export type SaveStatus = 'saved' | 'saving' | 'error'

function TabButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'border-b-2 px-1 pt-[19px] pb-[15px] text-[15px] font-medium transition-colors',
        active ? 'border-accent text-accent' : 'border-transparent text-ink hover:text-accent',
      )}
    >
      {children}
    </button>
  )
}

export function EditorTopBar({
  title,
  version,
  status,
  onRetry,
  onBack,
  onNavigate,
  onRecheck,
  rechecking,
  exportSlot,
  askSlot,
}: {
  title: string
  version: number
  status: SaveStatus
  /** Send the refused edits again. */
  onRetry: () => void
  onBack: () => void
  onNavigate: (tab: EditorTab) => void
  onRecheck: () => void
  rechecking: boolean
  exportSlot: ReactNode
  askSlot?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 py-3">
        <Brand compact />
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
          <span className="text-ink-muted" aria-hidden="true">
            /
          </span>
          <button type="button" onClick={onBack} className="rounded text-ink-muted hover:text-accent hover:underline">
            Check a draft
          </button>
          <span className="text-ink-muted" aria-hidden="true">
            /
          </span>
          <span className="truncate font-medium text-ink" aria-current="page">
            {title}
          </span>
          <span data-testid="save-state" aria-live="polite" className={cn('flex items-center gap-1 whitespace-nowrap text-xs', status === 'error' ? 'text-refutes' : 'text-ink-muted')}>
            v{version} ·{' '}
            {status === 'saving' ? (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                saving…
              </>
            ) : status === 'error' ? (
              <>
                not saved
                <TextButton onClick={onRetry} className="ml-1">
                  Retry
                </TextButton>
              </>
            ) : (
              'saved'
            )}
          </span>
        </nav>
      </div>
      <nav aria-label="Editor sections" className="ml-auto flex items-center gap-5">
        <TabButton active onClick={() => onNavigate('editor')}>
          Editor
        </TabButton>
        {exportSlot}
        <TabButton onClick={() => onNavigate('history')}>History</TabButton>
      </nav>
      <div className="flex items-center gap-3 py-3">
        <Button onClick={onRecheck} disabled={rechecking} aria-busy={rechecking}>
          {rechecking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
          {rechecking ? 'Checking…' : 'Re-check'}
        </Button>
        {askSlot}
        <RoleChip role="Author" icon={Pen} />
      </div>
    </header>
  )
}
