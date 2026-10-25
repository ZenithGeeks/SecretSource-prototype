/** Connecting a coding agent to a tab: the connect screen, Settings, Agents with its access card,
 * and the bridge that runs the agent's tool calls in the tab, holds a change for Apply, and
 * disconnects. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  // The bridge stream's handler while connected, and whether the stream was closed.
  bridge: null as ((event: object) => Promise<void> | void) | null,
  closed: false,
  // /user/preferences: what the server holds, and each PATCH it got.
  preferences: {} as Record<string, unknown>,
  patches: [] as Record<string, unknown>[],
  failPatches: false,
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  followEvents: vi.fn((path: string, onEvent: (event: object) => void) => {
    gateway.bridge = onEvent
    return () => {
      gateway.closed = true
    }
  }),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/user/preferences') {
      if (init?.method === 'PATCH') {
        if (gateway.failPatches) throw new Error('gateway down')
        const { patch } = JSON.parse(String(init.body)) as { patch: Record<string, unknown> }
        gateway.patches.push(patch)
        gateway.preferences = { ...gateway.preferences, ...patch }
      }
      return gateway.preferences
    }
    gateway.posts.push({ path, body: JSON.parse(String(init?.body)) })
    return { status: 'ok' }
  }),
}))

vi.mock('../src/lib/agentAccess', async (original) => ({
  ...(await original<typeof import('../src/lib/agentAccess')>()),
  GATEHOUSE_URL: 'https://gatehouse.example',
}))

import { AgentsSection } from '../src/components/AgentsSection'
import { AgentStatus, ConnectAgent } from '../src/components/ConnectAgent'
import { readAccess } from '../src/lib/agentAccess'
import type { ScreenActions } from '../src/lib/agentTools'
import { useAgentBridge } from '../src/lib/agentBridge'

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const actions: ScreenActions = { screen: 'library', screens: ['home', 'library'], openScreen: vi.fn(), openPaper: vi.fn() }

function Tab() {
  const bridge = useAgentBridge(actions)
  const [value, setValue] = useState('')
  return (
    <div>
      <input aria-label="Filter papers" data-ask-target="field:library-filter" value={value} onChange={(e) => setValue(e.target.value)} />
      <p>Filter: {value}</p>
      {bridge.connected ? <AgentStatus bridge={bridge} /> : <button onClick={() => bridge.connect(true)}>Allow</button>}
    </div>
  )
}

beforeEach(() => {
  gateway.posts = []
  gateway.bridge = null
  gateway.closed = false
  gateway.preferences = {}
  gateway.patches = []
  gateway.failPatches = false
  window.sessionStorage.clear()
})

describe('the connect screen', () => {
  it('says who is signed in and what the agent may do', async () => {
    gateway.preferences = { agentAccess: { level: 'read' } }
    const onAllow = vi.fn()
    renderWithQuery(<ConnectAgent email="ann@example.com" onAllow={onAllow} onCancel={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Let your coding agent use this tab' })).toBeInTheDocument()
    expect(screen.getByText('ann@example.com')).toBeInTheDocument()
    expect(await screen.findByText(/Read only · 12 tools/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(onAllow).toHaveBeenCalled()
  })

  it('sends a first-time setup to Settings instead of showing it', () => {
    renderWithQuery(<ConnectAgent email={null} onAllow={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText(/Settings, Agents shows how/)).toBeInTheDocument()
    expect(screen.queryByText(/claude mcp add/)).not.toBeInTheDocument()
  })

  it('closes on Escape without connecting', () => {
    const onCancel = vi.fn()
    renderWithQuery(<ConnectAgent email={null} onAllow={vi.fn()} onCancel={onCancel} />)

    expect(screen.getByText('Local workspace')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Settings, Agents', () => {
  it('shows the setup for Claude Code, Codex or VS Code', () => {
    renderWithQuery(<AgentsSection role="researcher" />)

    expect(screen.getByText(/claude mcp add --transport http --scope user secretsource/)).toHaveTextContent(
      'https://gatehouse.example/secretsource/mcp/',
    )
    expect(screen.getByRole('link', { name: 'https://gatehouse.example/me/' })).toHaveAttribute(
      'href',
      'https://gatehouse.example/me/',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    expect(screen.getByText(/\[mcp_servers\.secretsource\]/)).toBeInTheDocument()
    expect(screen.getByText(/~\/\.codex\/config\.toml/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'VS Code' }))
    expect(screen.getByText(/\$\{input:gatehouse-key\}/)).toBeInTheDocument()
    expect(screen.getByText(/VS Code asks for the key the first time/)).toBeInTheDocument()
  })

  it('links to the connect screen only in a role that can connect', () => {
    const { unmount } = renderWithQuery(<AgentsSection role="labeler" />)
    expect(screen.getByRole('link', { name: 'Connect this tab' })).toHaveAttribute(
      'href',
      expect.stringContaining('connect=agent'),
    )
    unmount()

    renderWithQuery(<AgentsSection role="teacher" />)
    expect(screen.queryByRole('link', { name: 'Connect this tab' })).not.toBeInTheDocument()
    expect(screen.getByText(/Switch to Researcher or Labeler/)).toBeInTheDocument()
  })
})

describe('the access card', () => {
  it('starts at full access and saves Read only', async () => {
    renderWithQuery(<AgentsSection role="researcher" />)

    expect(await screen.findByRole('radio', { name: 'Full access' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('18 tools')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Read only' }))

    expect(await screen.findByText('12 tools')).toBeInTheDocument()
    await waitFor(() => expect(gateway.patches).toEqual([{ agentAccess: { level: 'read' } }]))
  })

  it('starts Custom from the current tools and saves each tick', async () => {
    gateway.preferences = { agentAccess: { level: 'read' } }
    renderWithQuery(<AgentsSection role="researcher" />)

    fireEvent.click(await screen.findByRole('radio', { name: 'Custom' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), { target: { value: 'checking' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Start checking a paper/ }))

    await waitFor(() => expect(gateway.patches).toHaveLength(2))
    const tools = (gateway.patches[1].agentAccess as { tools: string[] }).tools
    expect(tools).toHaveLength(13)
    expect(tools).toContain('submit_analysis')
  })

  it('keeps both of two quick ticks', async () => {
    gateway.preferences = { agentAccess: { level: 'custom', tools: [] } }
    renderWithQuery(<AgentsSection role="researcher" />)

    fireEvent.click(await screen.findByRole('checkbox', { name: /List your papers/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Make BibTeX entries/ }))

    await waitFor(() => expect(gateway.patches).toHaveLength(2))
    expect(gateway.patches[1]).toEqual({ agentAccess: { level: 'custom', tools: ['list_papers', 'bibtex'] } })
  })

  it('puts the saved level back when saving fails', async () => {
    gateway.failPatches = true
    renderWithQuery(<AgentsSection role="researcher" />)

    fireEvent.click(await screen.findByRole('radio', { name: 'Read only' }))

    expect(await screen.findByText(/Not saved, try again/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Full access' })).toHaveAttribute('aria-checked', 'true')
  })

  it('reads a value it does not understand as read only, as the server does', () => {
    expect(readAccess(undefined)).toEqual({ level: 'full' })
    expect(readAccess('everything')).toEqual({ level: 'read' })
    expect(readAccess({ level: 'admin' })).toEqual({ level: 'read' })
    expect(readAccess({ level: 'custom', tools: 'all' })).toEqual({ level: 'read' })
    expect(readAccess({ level: 'custom', tools: ['bibtex', 3] })).toEqual({ level: 'custom', tools: ['bibtex'] })
  })
})

describe('the bridge', () => {
  it('opens only after Allow, and runs a tool call in the tab', async () => {
    render(<Tab />)
    expect(gateway.bridge).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await act(() => gateway.bridge?.({ type: 'tool', id: 'b1', name: 'open_screen', args: { screen: 'home' } }))

    expect(actions.openScreen).toHaveBeenCalledWith('home')
    expect(gateway.posts).toEqual([{ path: '/agent/bridge/results', body: { id: 'b1', result: { status: 'done', screen: 'home' } } }])
    expect(window.sessionStorage.getItem('agentBridge.connected')).toBe('1')
  })

  it('shows a change in the pill and fills the field only after Apply', async () => {
    window.sessionStorage.setItem('agentBridge.connected', '1') // connected before a reload
    render(<Tab />)

    let done: Promise<void> | void = undefined
    act(() => {
      done = gateway.bridge?.({ type: 'tool', id: 'b2', name: 'fill_field', args: { target: 'field:library-filter', text: 'late interaction' } })
    })
    const approve = await screen.findByRole('group', { name: 'Approve this change' })
    expect(approve).toHaveTextContent('late interaction')
    expect(gateway.posts).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await act(async () => {
      await done
    })
    expect(screen.getByText('Filter: late interaction')).toBeInTheDocument()
    expect(gateway.posts[0].body).toMatchObject({ id: 'b2', result: { status: 'applied' } })
  })

  it('closes the stream and forgets the tab on Disconnect', async () => {
    window.sessionStorage.setItem('agentBridge.connected', '1')
    render(<Tab />)

    fireEvent.click(screen.getByRole('button', { name: /Agent/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(gateway.closed).toBe(true))
    expect(window.sessionStorage.getItem('agentBridge.connected')).toBeNull()
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()
  })
})
