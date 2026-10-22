/**
 * What a connected agent may do (lib/agentAccess): the picker in Settings, Agents, and the short
 * summary on the connect screen. Both read the same stored choice, which the MCP server enforces.
 */

import { ChevronDown, Eye, PencilLine, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useState, type ComponentType } from 'react'

import type { AccessLevel, AgentAccess, AgentTool } from '../lib/agentAccess'
import { allowedNames, isAllowed, TOOL_GROUPS, useAgentAccess } from '../lib/agentAccess'
import { cn } from '../lib/utils'

const LEVELS: { level: AccessLevel; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { level: 'full', label: 'Full access', icon: ShieldCheck },
  { level: 'read', label: 'Read only', icon: Eye },
  { level: 'custom', label: 'Custom', icon: SlidersHorizontal },
]
const NEVER = 'It can never delete or upload anything, or change your account.'

export function AgentAccessCard() {
  const { access, update, isError, saveFailed } = useAgentAccess()
  const [query, setQuery] = useState('')
  // The first group starts open so the card shows what a level means without a click.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set([TOOL_GROUPS[0].id]))

  if (isError) return <p className="text-xs text-refutes">Your access setting could not be loaded. Close Settings and open it again.</p>
  if (!access) return <p className="text-xs text-ink-muted">Loading your access setting…</p>

  const allowedTools = allowedNames(access)
  const words = query.trim().toLowerCase()
  const matches = (tool: AgentTool) => !words || `${tool.label} ${tool.name}`.toLowerCase().includes(words)
  // Custom starts from the tools the current level allows.
  const chooseLevel = (level: AccessLevel) =>
    update((current) => (level === 'custom' ? { level, tools: allowedNames(current) } : { level }))
  const toggleTool = (name: string) =>
    update((current) => {
      const tools = allowedNames(current)
      return { level: 'custom', tools: tools.includes(name) ? tools.filter((n) => n !== name) : [...tools, name] }
    })
  const toggleGroup = (id: string) =>
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section aria-label="What your agent may do" className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm">
      <div role="radiogroup" aria-label="Access" className="grid grid-cols-3 gap-2">
        {LEVELS.map(({ level, label, icon: Icon }) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={access.level === level}
            onClick={() => chooseLevel(level)}
            className={cn(
              'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              access.level === level
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border-subtle text-ink-muted hover:border-accent hover:text-ink',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-muted" aria-live="polite">
        <span className="font-medium text-ink">{allowedTools.length} tools</span> · {summary(access, allowedTools.length)}
        {saveFailed && <span className="text-refutes"> · Not saved, try again</span>}
      </p>

      <label className="flex items-center gap-2 rounded-lg border border-border-subtle px-2.5 focus-within:border-accent">
        <Search className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tools…"
          aria-label="Search tools"
          className="min-h-9 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
        />
      </label>

      <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
        {TOOL_GROUPS.map((group) => {
          const shown = group.tools.filter(matches)
          if (!shown.length) return null
          const isOpen = Boolean(words) || openGroups.has(group.id)
          const count = group.tools.filter((tool) => isAllowed(access, tool)).length
          return (
            <div key={group.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.id)}
                disabled={Boolean(words)}
                className="flex min-h-11 w-full items-center gap-2 bg-neutral-soft px-3 text-left text-[13px] font-semibold text-ink hover:bg-accent-soft"
              >
                <span className="flex-1">{group.title}</span>
                <span className="text-accent">
                  {count}
                  <span className="font-normal text-ink-muted">/{group.tools.length}</span>
                </span>
                <ChevronDown className={cn('size-4 text-ink-muted transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {isOpen && (
                <ul className="divide-y divide-border-subtle">
                  {shown.map((tool) => (
                    <ToolRow
                      key={tool.name}
                      tool={tool}
                      on={isAllowed(access, tool)}
                      onToggle={access.level === 'custom' ? () => toggleTool(tool.name) : undefined}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-center text-xs text-ink-muted">Your agent gets the change on its next call. {NEVER}</p>
    </section>
  )
}

/** One tool: a checkbox in Custom, otherwise on or off as the level says. */
function ToolRow({ tool, on, onToggle }: { tool: AgentTool; on: boolean; onToggle?: () => void }) {
  const badge = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tool.kind === 'read' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border-subtle text-ink-muted',
      )}
    >
      {tool.kind === 'read' ? <Eye className="size-3" aria-hidden="true" /> : <PencilLine className="size-3" aria-hidden="true" />}
      {tool.kind === 'read' ? 'Read' : 'Acts'}
    </span>
  )
  if (onToggle) {
    return (
      <li>
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 px-3 text-[13px] text-ink hover:bg-accent-soft/50">
          <input type="checkbox" checked={on} onChange={onToggle} className="size-4 accent-[var(--color-accent)]" />
          <span className="flex-1">{tool.label}</span>
          {badge}
        </label>
      </li>
    )
  }
  return (
    <li className={cn('flex min-h-10 items-center gap-2.5 px-3 text-[13px]', on ? 'text-ink' : 'text-ink-muted line-through')}>
      <span className="flex-1">{tool.label}</span>
      {on ? badge : <span className="text-[11px]">Off</span>}
    </li>
  )
}

/** The connect screen's line: the level and how many tools it allows, with where to change it. */
export function AccessSummary() {
  const { access } = useAgentAccess()
  if (!access) return null
  const count = allowedNames(access).length
  const level = LEVELS.find((option) => option.level === access.level)
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-subtle px-3 py-2.5 text-left">
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        {level && <level.icon className="size-4 text-accent" aria-hidden="true" />}
        {level?.label} · {count} tools
      </p>
      <p className="text-xs text-ink-muted">
        {summary(access, count)}. Change it in Settings, Agents. {NEVER}
      </p>
    </div>
  )
}

function summary(access: AgentAccess, count: number): string {
  if (access.level === 'full') return 'reads your papers and acts in your tab'
  if (access.level === 'read') return 'reads only, changes nothing'
  return count ? 'only the tools you picked' : 'no tools picked yet'
}
