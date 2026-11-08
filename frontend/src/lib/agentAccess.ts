/**
 * Which MCP tools a connected coding agent may use: the `agentAccess` preference, which
 * backend/app/mcp_server.py (allowed_tools) reads on every tools/list and tools/call. Settings,
 * Agents edits it; the connect screen shows it.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { accountApi } from './accountApi'
import { PREFERENCES_KEY, usePreferencesSync } from './useAccountSettings'

/** The team gateway (Gatehouse) in front of /secretsource/mcp/ and the /me/ key page. */
export const GATEHOUSE_URL = import.meta.env.VITE_GATEHOUSE_URL ?? ''

export type AgentAccess = { level: 'full' } | { level: 'read' } | { level: 'custom'; tools: string[] }
export type AccessLevel = AgentAccess['level']

/** "read" tools change nothing; they are READ_ONLY in mcp_server.py, which is what Read only allows.
 * "act" tools move the tab or start work. */
export type AgentTool = { name: string; label: string; kind: 'read' | 'act' }
export type ToolGroup = { id: string; title: string; tools: AgentTool[] }

// Every MCP tool, by name. A tool the server adds and this list lacks is still allowed under
// Full access, but cannot be picked in Custom; add it here when it is added to mcp_server.py.
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'papers',
    title: 'Papers and claims',
    tools: [
      { name: 'list_papers', label: 'List your papers', kind: 'read' },
      { name: 'get_analysis', label: 'Open an analysis and its claims', kind: 'read' },
      { name: 'get_claim', label: "Read a claim's evidence", kind: 'read' },
      { name: 'search_claims', label: 'Search your claims', kind: 'read' },
      { name: 'find_in_paper', label: 'Find text in a paper', kind: 'read' },
      { name: 'find_support', label: 'Find passages for a claim', kind: 'read' },
      { name: 'check_text', label: 'Check writing against your papers', kind: 'read' },
      { name: 'ask_library', label: 'Ask your library', kind: 'read' },
      { name: 'get_gaps', label: 'List unbacked and contradicted claims', kind: 'read' },
      { name: 'bibtex', label: 'Make BibTeX entries', kind: 'read' },
      { name: 'labeling_progress', label: 'See labeling progress', kind: 'read' },
    ],
  },
  {
    id: 'screen',
    title: 'Your open tab',
    tools: [
      { name: 'read_screen', label: 'See what is on the screen', kind: 'read' },
      { name: 'open_screen', label: 'Open screens', kind: 'act' },
      { name: 'open_paper', label: 'Open papers', kind: 'act' },
      { name: 'point_at', label: 'Point with its cursor', kind: 'act' },
      { name: 'fill_field', label: 'Fill in a field, after you press Apply', kind: 'act' },
    ],
  },
  {
    id: 'work',
    title: 'Start work',
    tools: [
      { name: 'submit_analysis', label: 'Start checking a paper', kind: 'act' },
      { name: 'review_claim', label: 'Review a labeled claim (saves a review)', kind: 'act' },
    ],
  },
]

const ALL_TOOLS = TOOL_GROUPS.flatMap((group) => group.tools)

/** The same reading as allowed_tools on the server: no choice is full access, and anything
 * it cannot read is read only, never full. */
export function readAccess(value: unknown): AgentAccess {
  if (value === undefined || value === null) return { level: 'full' }
  if (typeof value !== 'object' || Array.isArray(value)) return { level: 'read' }
  const { level, tools } = value as { level?: unknown; tools?: unknown }
  if (level === 'full') return { level: 'full' }
  if (level === 'custom' && Array.isArray(tools)) {
    return { level: 'custom', tools: tools.filter((name): name is string => typeof name === 'string') }
  }
  return { level: 'read' }
}

export function isAllowed(access: AgentAccess, tool: AgentTool): boolean {
  if (access.level === 'full') return true
  if (access.level === 'read') return tool.kind === 'read'
  return access.tools.includes(tool.name)
}

/** The tool names a level allows, so Custom starts from what the person had. */
export function allowedNames(access: AgentAccess): string[] {
  return ALL_TOOLS.filter((tool) => isAllowed(access, tool)).map((tool) => tool.name)
}

type Preferences = Record<string, unknown>
const SAVE_KEY = ['agentAccess', 'save']

/**
 * The stored access, and `update`, which saves a change at once (an optimistic update, as in the
 * TanStack Query guide): the cache changes first, a failed PATCH puts the earlier value back,
 * and the server's copy is read again once the last PATCH ends.
 *
 * `access` is undefined only while the preferences load. A missing stored value means Full.
 */
export function useAgentAccess() {
  // Enabled outside the Settings modal too: the connect screen shows the level.
  const { data, isError } = usePreferencesSync(true)
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationKey: SAVE_KEY,
    // The backend keeps whichever PATCH arrives last, so saves go one at a time and the last click wins.
    scope: { id: 'agentAccess' },
    mutationFn: ({ next }: { next: AgentAccess; previous?: Preferences }) =>
      accountApi.patchPreferences({ agentAccess: next }),
    onError: (_error, { previous }) => queryClient.setQueryData(PREFERENCES_KEY, previous),
    onSettled: () => {
      // Refetching while another change is in flight would show the server without it.
      if (queryClient.isMutating({ mutationKey: SAVE_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY })
      }
    },
  })

  /** Saves `change(current)`. It reads the cache, not this render, so two quick ticks both count. */
  const update = (change: (current: AgentAccess) => AgentAccess) => {
    const previous = queryClient.getQueryData<Preferences>(PREFERENCES_KEY)
    const next = change(readAccess(previous?.agentAccess))
    void queryClient.cancelQueries({ queryKey: PREFERENCES_KEY })
    queryClient.setQueryData<Preferences>(PREFERENCES_KEY, { ...previous, agentAccess: next })
    save.mutate({ next, previous })
  }

  const access = data ? readAccess(data.agentAccess) : undefined
  return { access, update, isError, saveFailed: save.isError }
}
