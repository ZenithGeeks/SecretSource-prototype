/** Ask's Do it mode: the browser tools the screen agent calls, and the loop that runs them and
 * sends their results back. A change waits for Apply. */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  // One list of events per POST, in order.
  streams: [] as object[][],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  postEvents: vi.fn(async (path: string, body: Record<string, unknown>, onEvent: (event: object) => void) => {
    gateway.posts.push({ path, body })
    for (const event of gateway.streams.shift() ?? []) onEvent(event)
  }),
}))

import { DoIt } from '../src/components/DoIt'
import { runTool, type ScreenActions } from '../src/lib/agentTools'

function actions(overrides: Partial<ScreenActions> = {}): ScreenActions {
  return { screen: 'library', screens: ['home', 'library'], openScreen: vi.fn(), openPaper: vi.fn(), ...overrides }
}

const context = (over: Partial<Parameters<typeof runTool>[1]> = {}) => ({
  actions: actions(),
  point: vi.fn(),
  confirm: vi.fn(async () => true),
  ...over,
})

/** A screen with a sidebar button, a field and a paper, the way the app marks them. */
function Screen() {
  const [value, setValue] = useState('')
  return (
    <div>
      <button data-ask-target="screen:home">Home</button>
      <input aria-label="Filter papers" data-ask-target="field:library-filter" value={value} onChange={(e) => setValue(e.target.value)} />
      <p>Filter: {value}</p>
      <button data-ask-target="paper:a1">ColBERTv2</button>
    </div>
  )
}

describe('the screen agent tools', () => {
  beforeEach(() => {
    gateway.posts = []
    gateway.streams = []
    vi.useRealTimers()
  })

  it('read_screen lists the screen and every marked thing with its label', async () => {
    render(<Screen />)
    // jsdom has no layout, so give every element a box the way a browser would.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const result = await runTool({ id: '1', name: 'read_screen', args: {} }, context())
    expect(result).toEqual({
      screen: 'library',
      targets: [
        { target: 'screen:home', label: 'Home' },
        { target: 'field:library-filter', label: 'Filter papers' },
        { target: 'paper:a1', label: 'ColBERTv2' },
      ],
    })
  })

  it('point_at says when a target is not on the screen, so the agent can read it again', async () => {
    render(<Screen />)
    const point = vi.fn()
    expect(await runTool({ id: '1', name: 'point_at', args: { target: 'paper:zz', note: 'x' } }, context({ point }))).toEqual({
      status: 'error',
      message: 'paper:zz is not on the screen; call read_screen',
    })
    expect(point).not.toHaveBeenCalled()
  })

  it('fill_field types only after Apply, the way React sees typing', async () => {
    render(<Screen />)
    const cancelled = await runTool(
      { id: '1', name: 'fill_field', args: { target: 'field:library-filter', text: 'colbert' } },
      context({ confirm: vi.fn(async () => false) }),
    )
    expect(cancelled).toEqual({ status: 'cancelled' })
    expect(screen.getByText('Filter:')).toBeInTheDocument()

    const applied = await runTool({ id: '2', name: 'fill_field', args: { target: 'field:library-filter', text: 'colbert' } }, context())
    expect(applied).toEqual({ status: 'applied' })
    expect(screen.getByText('Filter: colbert')).toBeInTheDocument()
  })

  it('open_screen opens only a screen the role has', async () => {
    const openScreen = vi.fn()
    const call = (name: string) => runTool({ id: '1', name: 'open_screen', args: { screen: name } }, context({ actions: actions({ openScreen }) }))
    expect(await call('admin')).toMatchObject({ status: 'error' })
    expect(await call('home')).toEqual({ status: 'done', screen: 'home' })
    expect(openScreen).toHaveBeenCalledWith('home')
  })
})

describe('Do it', () => {
  beforeEach(() => {
    gateway.posts = []
    gateway.streams = []
  })

  it('runs each tool the agent asks for, sends the result back, and shows what the agent says', async () => {
    const openPaper = vi.fn()
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'step', name: 'list_papers' }, { type: 'tool', id: 'c1', name: 'open_paper', args: { analysis_id: 'a1' } }, { type: 'done' }],
      [{ type: 'say', text: 'ColBERTv2 is open.' }, { type: 'done' }],
    ]
    render(<DoIt actions={actions({ openPaper })} />)
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'Open ColBERT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))

    expect(await screen.findByText('ColBERTv2 is open.')).toBeInTheDocument()
    expect(openPaper).toHaveBeenCalledWith('a1')
    expect(screen.getByText('Looking through your papers')).toBeInTheDocument()
    expect(gateway.posts).toEqual([
      { path: '/agent/runs', body: { message: 'Open ColBERT', screen: 'library' } },
      { path: '/agent/runs/s1/results', body: { id: 'c1', name: 'open_paper', result: { status: 'done' } } },
    ])
  })

  it('shows a change and waits for Apply before the field changes', async () => {
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'fill_field', args: { target: 'field:library-filter', text: 'late interaction' } }, { type: 'done' }],
      [{ type: 'say', text: 'Filtered.' }, { type: 'done' }],
    ]
    render(
      <>
        <Screen />
        <DoIt actions={actions()} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show me where to search the library' }))

    const approve = await screen.findByRole('group', { name: 'Approve this change' })
    expect(approve).toHaveTextContent('late interaction')
    expect(gateway.posts).toHaveLength(1) // nothing sent back until the person answers
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Filtered.')).toBeInTheDocument()
    expect(screen.getByText('Filter: late interaction')).toBeInTheDocument()
    await waitFor(() => expect(gateway.posts[1].body).toMatchObject({ name: 'fill_field', result: { status: 'applied' } }))
  })

  it('shows a badge when the agent hands work to a specialist, and settles it when the specialist answers', async () => {
    gateway.streams = [
      [
        { type: 'session', id: 's1' },
        { type: 'agent', name: 'data_agent', state: 'working', task: 'Which claims are contradicted?' },
        { type: 'step', name: 'get_gaps' },
        { type: 'agent', name: 'data_agent', state: 'done' },
        { type: 'say', text: 'Two claims are contradicted.' },
        { type: 'done' },
      ],
    ]
    render(<DoIt actions={actions()} />)
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'Which claims are contradicted?' } })
    fireEvent.submit(screen.getByLabelText('What should the AI do?').closest('form')!)

    expect(await screen.findByText('Two claims are contradicted.')).toBeInTheDocument()
    const badge = screen.getByText('Papers specialist').parentElement!.parentElement!
    expect(within(badge).getByText('Done')).toBeInTheDocument()
    expect(within(badge).getByText('Which claims are contradicted?')).toBeInTheDocument()
    expect(screen.getByText('Looking for gaps in your library')).toBeInTheDocument()
  })

  it('marks a hand-over stopped when the stream ends before the specialist answers', async () => {
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'agent', name: 'data_agent', state: 'working', task: 'Check my draft' }, { type: 'done' }],
    ]
    render(<DoIt actions={actions()} />)
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'Check my draft' } })
    fireEvent.submit(screen.getByLabelText('What should the AI do?').closest('form')!)

    expect(await screen.findByText('Stopped')).toBeInTheDocument()
  })
})
