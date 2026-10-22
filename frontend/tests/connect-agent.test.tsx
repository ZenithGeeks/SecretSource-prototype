/** Connecting a coding agent to a tab: the connect screen, and the bridge that runs the agent's
 * tool calls in the tab, holds a change for Apply, and disconnects. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  // The bridge stream's handler while connected, and whether the stream was closed.
  bridge: null as ((event: object) => Promise<void> | void) | null,
  closed: false,
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  followEvents: vi.fn((path: string, onEvent: (event: object) => void) => {
    gateway.bridge = onEvent
    return () => {
      gateway.closed = true
    }
  }),
  request: vi.fn(async (path: string, init: RequestInit) => {
    gateway.posts.push({ path, body: JSON.parse(String(init.body)) })
    return { status: 'ok' }
  }),
}))

import { AgentsSection } from '../src/components/AgentsSection'
import { AgentStatus, ConnectAgent } from '../src/components/ConnectAgent'
import type { ScreenActions } from '../src/lib/agentTools'
import { useAgentBridge } from '../src/lib/agentBridge'

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
  window.sessionStorage.clear()
})

describe('the connect screen', () => {
  it('says who is signed in and what the agent can and cannot do', () => {
    const onAllow = vi.fn()
    render(<ConnectAgent email="ann@example.com" onAllow={onAllow} onCancel={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Let your coding agent use this tab' })).toBeInTheDocument()
    expect(screen.getByText('ann@example.com')).toBeInTheDocument()
    expect(screen.getByText('Fill in a field, after you press Apply')).toBeInTheDocument()
    expect(screen.getByText('Save labels, delete or upload anything')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(onAllow).toHaveBeenCalled()
  })

  it('sends a first-time setup to Settings instead of showing it', () => {
    render(<ConnectAgent email={null} onAllow={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText(/Settings, Agents shows how/)).toBeInTheDocument()
    expect(screen.queryByText(/claude mcp add/)).not.toBeInTheDocument()
  })

  it('closes on Escape without connecting', () => {
    const onCancel = vi.fn()
    render(<ConnectAgent email={null} onAllow={vi.fn()} onCancel={onCancel} />)

    expect(screen.getByText('Local workspace')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Settings, Agents', () => {
  it('shows the setup for Claude Code, Codex or VS Code', () => {
    render(<AgentsSection role="researcher" />)

    expect(screen.getByText(/claude mcp add --transport http --scope user secretsource/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    expect(screen.getByText(/\[mcp_servers\.secretsource\]/)).toBeInTheDocument()
    expect(screen.getByText(/~\/\.codex\/config\.toml/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'VS Code' }))
    expect(screen.getByText(/\$\{input:gatehouse-key\}/)).toBeInTheDocument()
    expect(screen.getByText(/VS Code asks for the key the first time/)).toBeInTheDocument()
  })

  it('links to the connect screen only in a role that can connect', () => {
    const { unmount } = render(<AgentsSection role="labeler" />)
    expect(screen.getByRole('link', { name: 'Connect this tab' })).toHaveAttribute(
      'href',
      expect.stringContaining('connect=agent'),
    )
    unmount()

    render(<AgentsSection role="teacher" />)
    expect(screen.queryByRole('link', { name: 'Connect this tab' })).not.toBeInTheDocument()
    expect(screen.getByText(/Switch to Researcher or Labeler/)).toBeInTheDocument()
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
