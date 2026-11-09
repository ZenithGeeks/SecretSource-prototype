/**
 * Do it when a run goes long, is stopped, fails, or takes the person somewhere: the working line,
 * Stop, the way back, a specialist that fails, and the events the agent sends that the happy path
 * leaves out.
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Stream = object[] | Error | ((onEvent: (event: object) => void, signal: AbortSignal) => Promise<void>)

const gateway = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  streams: [] as unknown[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  postEvents: vi.fn(async (path: string, body: Record<string, unknown>, onEvent: (event: object) => void, signal: AbortSignal) => {
    gateway.posts.push({ path, body })
    const next = (gateway.streams.shift() ?? []) as Stream
    if (typeof next === 'function') return next(onEvent, signal)
    if (next instanceof Error) throw next
    for (const event of next) onEvent(event)
  }),
}))

import { DoIt } from '../src/components/DoIt'
import type { ScreenActions } from '../src/lib/agentTools'
import { clearDoItConversation } from '../src/lib/doItConversation'
import { useScreenAgent } from '../src/lib/screenAgent'

const actions = (over: Partial<ScreenActions> = {}): ScreenActions => ({
  screen: 'library',
  screens: ['home', 'library', 'analysis'],
  openScreen: vi.fn(),
  openPaper: vi.fn(),
  ...over,
})

/** A stream that stays open until the run is stopped, as a long answer does. */
const hangs: Stream = (_onEvent, signal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))

const field = () => screen.getByLabelText('What should the AI do?')

function sendMessage(text: string) {
  fireEvent.change(field(), { target: { value: text } })
  fireEvent.submit(field().closest('form')!)
}

beforeEach(() => {
  gateway.posts = []
  gateway.streams = []
  clearDoItConversation()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a run in progress', () => {
  it('says it is working, ignores a second message, and stops on Stop', async () => {
    gateway.streams = [hangs]
    render(<DoIt actions={actions()} />)

    sendMessage('Open the graph')
    expect(await screen.findByText(/Working…/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Working')
    expect(field()).toBeDisabled()

    // The field is disabled, but a submit that gets through is still ignored.
    fireEvent.change(field(), { target: { value: 'And the library' } })
    fireEvent.submit(field().closest('form')!)
    expect(gateway.posts).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Stopped. Nothing was changed.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Stopped')
    expect(screen.queryByText('The agent could not be reached. Try again.')).not.toBeInTheDocument()
  })

  it('says Stop is there once a run takes more than half a minute', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    gateway.streams = [hangs]
    const { unmount } = render(<DoIt actions={actions()} />)

    sendMessage('Open the graph')
    expect(screen.queryByText(/still going/)).not.toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(31_000))

    expect(screen.getByText(/still going. Stop ends it and changes nothing./)).toBeInTheDocument()
    unmount()
  })

  it('ignores a message with nothing in it', () => {
    render(<DoIt actions={actions()} />)

    sendMessage('   ')

    expect(gateway.posts).toEqual([])
  })
})

describe('what the agent can send', () => {
  it('shows an error event as a line, and reads it out as a finished reply', async () => {
    gateway.streams = [[{ type: 'session', id: 's1' }, { type: 'error', message: 'out of budget' }, { type: 'done' }]]
    render(<DoIt actions={actions()} />)

    sendMessage('Open the graph')

    const line = await screen.findByText('Stopped: out of budget')
    expect(line).toHaveClass('text-refutes')
    expect(screen.getByRole('status')).toHaveTextContent('Done. The reply is below.')
  })

  it('shows a step it has no words for by its own name', async () => {
    gateway.streams = [[{ type: 'step', name: 'rank_papers' }, { type: 'say', text: 'Ranked.' }, { type: 'done' }]]
    render(<DoIt actions={actions()} />)

    sendMessage('Rank my papers')

    expect(await screen.findByText('rank_papers')).toBeInTheDocument()
  })

  it('shows a specialist with no task, under its own name, and marks it failed', async () => {
    gateway.streams = [
      [
        { type: 'agent', name: 'chart_agent', state: 'working' },
        { type: 'agent', name: 'chart_agent', state: 'failed' },
        { type: 'say', text: 'It did not work out.' },
        { type: 'done' },
      ],
    ]
    render(<DoIt actions={actions()} />)

    sendMessage('Draw a chart')

    expect(await screen.findByText('It did not work out.')).toBeInTheDocument()
    expect(screen.getByText('chart_agent')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('says it could not reach the agent when the first request fails', async () => {
    gateway.streams = [new Error('503: down')]
    render(<DoIt actions={actions()} />)

    sendMessage('Open the graph')

    expect(await screen.findByText('The agent could not be reached. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Done. The reply is below.')
  })

  it('sends a result to the results route even when no session event came first', async () => {
    gateway.streams = [[{ type: 'tool', id: 'c1', name: 'open_paper', args: { analysis_id: 'a1' } }], []]
    const { result } = renderHook(() => useScreenAgent(actions(), vi.fn()))

    await act(() => result.current.send('Open it'))

    expect(gateway.posts.map((post) => post.path)).toEqual(['/agent/runs', '/agent/runs//results'])
  })
})

describe('after a run took the person elsewhere', () => {
  it('offers the way back to the paper they were on', async () => {
    window.history.replaceState(null, '', '/?analysis=a1')
    const openPaper = vi.fn()
    const here = actions({ screen: 'analysis', openPaper })
    gateway.streams = [[{ type: 'say', text: 'Done.' }, { type: 'done' }]]
    const { rerender } = render(<DoIt actions={here} />)

    sendMessage('Go to the library')
    await screen.findByText('Done.')
    expect(screen.queryByRole('button', { name: 'Back to where you were' })).not.toBeInTheDocument()
    window.history.replaceState(null, '', '/?screen=library')
    rerender(<DoIt actions={{ ...here, screen: 'library' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back to where you were' }))

    expect(openPaper).toHaveBeenCalledWith('a1')
    expect(screen.queryByRole('button', { name: 'Back to where you were' })).not.toBeInTheDocument()
  })

  it('offers the way back to the screen when no paper was open, or the role has no papers', async () => {
    const openScreen = vi.fn()
    const here = actions({ screen: 'library', openScreen, openPaper: undefined })
    gateway.streams = [[{ type: 'say', text: 'Done.' }, { type: 'done' }]]
    const { rerender } = render(<DoIt actions={here} />)

    sendMessage('Go to home')
    await screen.findByText('Done.')
    rerender(<DoIt actions={{ ...here, screen: 'home' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back to where you were' }))

    expect(openScreen).toHaveBeenCalledWith('library')
  })

  it('does not show the way back while the run is still going', async () => {
    gateway.streams = [hangs]
    const here = actions()
    const { rerender } = render(<DoIt actions={here} />)

    sendMessage('Go to home')
    await screen.findByText(/Working…/)
    rerender(<DoIt actions={{ ...here, screen: 'home' }} />)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to where you were' })).not.toBeInTheDocument())
  })
})
