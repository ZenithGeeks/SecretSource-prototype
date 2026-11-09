/**
 * A coding agent in the tab, the edges: events the tab ignores, a tool that throws, a role switch
 * the agent asks for, the cursor leaving after a call, the connect screen opened by a link, and
 * the AI cursor's scrolling and observing.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  bridge: null as ((event: object) => Promise<void> | void) | null,
  failResults: false,
  email: null as string | null,
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  followEvents: vi.fn((_path: string, onEvent: (event: object) => void) => {
    gateway.bridge = onEvent
    return () => {}
  }),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/user/preferences') return {}
    if (gateway.failResults) throw new Error('gateway restarted')
    gateway.posts.push({ path, body: JSON.parse(String(init?.body)) })
    return { status: 'ok' }
  }),
}))
vi.mock('../src/lib/useAuth', () => ({
  useAuth: () => ({ session: gateway.email ? { user: { email: gateway.email } } : null, loading: false }),
  endSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

import { AiCursor } from '../src/components/AiCursor'
import { AgentStatus } from '../src/components/ConnectAgent'
import { useAgentConnection } from '../src/components/useAgentConnection'
import { useAgentBridge } from '../src/lib/agentBridge'
import type { ScreenActions } from '../src/lib/agentTools'

const withQuery = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)

const screenActions = (over: Partial<ScreenActions> = {}): ScreenActions => ({
  screen: 'library',
  screens: ['home', 'library'],
  openScreen: vi.fn(),
  openPaper: vi.fn(),
  ...over,
})

function Tab({ actions }: { actions: ScreenActions }) {
  const bridge = useAgentBridge(actions)
  const [value, setValue] = useState('')
  return (
    <div>
      <input aria-label="Filter papers" data-ask-target="field:library-filter" value={value} onChange={(e) => setValue(e.target.value)} />
      <p>Pointing at {bridge.pointing?.target.id ?? 'nothing'}</p>
      {bridge.connected ? <AgentStatus bridge={bridge} /> : <button onClick={() => bridge.connect(true)}>Allow</button>}
    </div>
  )
}

function connectedTab(actions: ScreenActions) {
  window.sessionStorage.setItem('agentBridge.connected', '1')
  return render(<Tab actions={actions} />)
}

beforeEach(() => {
  gateway.posts = []
  gateway.bridge = null
  gateway.failResults = false
  gateway.email = null
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the bridge', () => {
  it('ignores an event that is not a tool call', async () => {
    connectedTab(screenActions())

    await act(() => gateway.bridge?.({ type: 'ready' }))

    expect(gateway.posts).toEqual([])
  })

  it('tells the agent when the tab could not run its tool call', async () => {
    const openScreen = vi.fn(() => {
      throw new Error('the screen is gone')
    })
    connectedTab(screenActions({ openScreen }))

    await act(() => gateway.bridge?.({ type: 'tool', id: 'b1', name: 'open_screen', args: { screen: 'home' } }))

    expect(gateway.posts[0].body).toEqual({ id: 'b1', result: { status: 'error', message: 'the tab could not run it: the screen is gone' } })
  })

  it('goes on when the gateway no longer wants the result', async () => {
    gateway.failResults = true
    const openPaper = vi.fn()
    connectedTab(screenActions({ openPaper }))

    await act(() => gateway.bridge?.({ type: 'tool', id: 'b1', name: 'open_paper', args: { analysis_id: 'a1' } }))

    expect(openPaper).toHaveBeenCalledWith('a1')
  })

  it('lets the cursor leave a moment after the call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    connectedTab(screenActions())

    let done: Promise<void> | void
    act(() => {
      done = gateway.bridge?.({ type: 'tool', id: 'b1', name: 'fill_field', args: { target: 'field:library-filter', text: 'colbert' } })
    })
    // Fake timers: findBy would wait on a timer that never fires, so let the card render by hand.
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await act(async () => {
      await done
    })
    expect(screen.getByText('Pointing at library-filter')).toBeInTheDocument()

    await act(async () => void vi.advanceTimersByTime(2500))

    expect(screen.getByText('Pointing at nothing')).toBeInTheDocument()
  })

  it('moves to the role the agent asked for only after Switch, and only once the result is sent', async () => {
    const switchRole = vi.fn()
    connectedTab(screenActions({ role: 'researcher', switchRole }))

    let done: Promise<void> | void
    act(() => {
      done = gateway.bridge?.({ type: 'tool', id: 'b1', name: 'switch_role', args: { role: 'labeler', reason: 'Labels are there' } })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Switch' }))
    expect(switchRole).not.toHaveBeenCalled()
    await act(async () => {
      await done
    })

    expect(gateway.posts[0].body).toEqual({ id: 'b1', result: { status: 'switched' } })
    expect(switchRole).toHaveBeenCalledWith('labeler')
  })

  it('answers Cancel for a change that waits when the person disconnects', async () => {
    connectedTab(screenActions())

    let done: Promise<void> | void
    act(() => {
      done = gateway.bridge?.({ type: 'tool', id: 'b1', name: 'fill_field', args: { target: 'field:library-filter', text: 'x' } })
    })
    await screen.findByRole('group', { name: 'Approve this change' })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await act(async () => {
      await done
    })

    expect(gateway.posts[0].body).toEqual({ id: 'b1', result: { status: 'cancelled' } })
  })
})

describe('the agent pill', () => {
  it('lists the steps so far, the newest in the stronger colour, and says it is waiting when idle', async () => {
    connectedTab(screenActions())

    await act(() => gateway.bridge?.({ type: 'tool', id: 'b1', name: 'read_screen', args: {} }))
    await act(() => gateway.bridge?.({ type: 'tool', id: 'b2', name: 'open_paper', args: { analysis_id: 'a1' } }))
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }))

    const steps = screen.getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual(['Reading the screen', 'Opening the paper'])
    expect(steps[1]).toHaveClass('text-ink')
    expect(steps[0]).not.toHaveClass('text-ink')
    expect(screen.getByText('Waiting for your agent')).toBeInTheDocument()
  })

  it('shows the step in progress while the agent works', async () => {
    const slow = screenActions({ screens: ['home'], openScreen: vi.fn() })
    connectedTab(slow)

    let done: Promise<void> | void
    act(() => {
      done = gateway.bridge?.({ type: 'tool', id: 'b1', name: 'open_screen', args: { screen: 'home' } })
    })
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }))
    expect(screen.getAllByText('Opening home')).toHaveLength(2)
    await act(async () => {
      await done
    })
  })
})

function Connection({ actions }: { actions?: ScreenActions }) {
  const agent = useAgentConnection(actions)
  return (
    <>
      {agent.pill}
      <button onClick={agent.openConnect}>Connect an agent</button>
      {agent.overlay}
    </>
  )
}

describe('the connect screen', () => {
  it('opens from a link, drops the link on Cancel, and opens again by hand', async () => {
    window.history.replaceState(null, '', '/?connect=agent&screen=library')
    gateway.email = 'ann@example.com'
    render(withQuery(<Connection actions={screenActions()} />))

    expect(screen.getByText('ann@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).toBe('?screen=library')

    fireEvent.click(screen.getByRole('button', { name: 'Connect an agent' }))
    expect(screen.getByRole('dialog', { name: 'Let your coding agent use this tab' })).toBeInTheDocument()
  })

  it('connects on Allow, and shows the pill', async () => {
    window.history.replaceState(null, '', '/?connect=agent')
    render(withQuery(<Connection actions={screenActions()} />))

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
    expect(screen.getByRole('button', { name: /Agent/ })).toBeInTheDocument()
    expect(window.sessionStorage.getItem('agentBridge.connected')).toBe('1')
  })

  it('does not open in a role that cannot connect', () => {
    window.history.replaceState(null, '', '/?connect=agent')
    render(withQuery(<Connection />))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the AI cursor', () => {
  function target(parentStyle = '') {
    document.body.innerHTML = `<div id="panel" style="${parentStyle}"><button data-ask-target="paper:a1">A paper</button></div>`
    const button = document.querySelector<HTMLElement>('[data-ask-target]')!
    button.getBoundingClientRect = () => ({ top: 20, left: 30, bottom: 60, right: 230, width: 200, height: 40 }) as DOMRect
    button.scrollIntoView = vi.fn()
    const panel = document.getElementById('panel')!
    panel.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 }) as DOMRect
    return button
  }
  const pointing = { target: { kind: 'paper' as const, id: 'a1' }, tone: 'shows' as const }

  it('scrolls its target into view smoothly, or at once for a reader who wants less motion', async () => {
    const button = target()
    const { unmount } = render(<AiCursor pointing={pointing} />)
    expect(button.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' })
    unmount()

    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<AiCursor pointing={pointing} />)
    expect(button.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' })
    expect(await screen.findByText('Here')).toBeInTheDocument()
  })

  it('leaves the scrolling to the panel when it is told to', () => {
    const button = target()
    render(<AiCursor pointing={pointing} scroll={false} />)

    expect(button.scrollIntoView).not.toHaveBeenCalled()
  })

  it('watches the target and the panel that scrolls around it, and stops when it goes', async () => {
    const observed: Element[] = []
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = (element: Element) => void observed.push(element)
        disconnect = disconnect
      },
    )
    const button = target('overflow-y: auto')
    const { unmount } = render(<AiCursor pointing={pointing} />)

    await screen.findByText('Here')
    expect(observed).toEqual([button, document.getElementById('panel')])
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('leaves when the target is gone', async () => {
    target()
    const view = render(<AiCursor pointing={pointing} />)
    await screen.findByText('Here')

    view.rerender(<AiCursor pointing={null} />)

    await waitFor(() => expect(screen.queryByText('Here')).not.toBeInTheDocument())
  })
})
