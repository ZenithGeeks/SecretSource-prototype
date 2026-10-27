/** Ask's Do it mode: the browser tools the screen agent calls, and the loop that runs them and
 * sends their results back. A change waits for Apply. */

import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  posts: [] as { path: string; body: Record<string, unknown> }[],
  // One list of events per POST, in order; an Error makes that POST fail.
  streams: [] as (object[] | Error)[],
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  postEvents: vi.fn(async (path: string, body: Record<string, unknown>, onEvent: (event: object) => void) => {
    gateway.posts.push({ path, body })
    const next = gateway.streams.shift() ?? []
    if (next instanceof Error) throw next
    for (const event of next) onEvent(event)
  }),
}))

import { DoIt } from '../src/components/DoIt'
import { describeTool, runTool, type ScreenActions } from '../src/lib/agentTools'
import { postEvents } from '../src/lib/api'
import type { Pointing } from '../src/lib/askCursor'
import { clearDoItConversation, leaveDoItConversation, peekDoItConversation } from '../src/lib/doItConversation'
import { useScreenAgent } from '../src/lib/screenAgent'

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

  it('switch_role asks first, maps author to the app’s writer id, and does not move yet', async () => {
    const onSwitched = vi.fn()
    const switchRole = vi.fn()
    const confirm = vi.fn(async () => true)
    const base = { role: 'researcher' as const, switchRole, confirmLeave: () => true }
    const switched = await runTool(
      { id: '1', name: 'switch_role', args: { role: 'author', reason: 'Your drafts are there' } },
      context({ actions: actions(base), confirm, onSwitched }),
    )
    expect(switched).toEqual({ status: 'switched' })
    expect(onSwitched).toHaveBeenCalledWith('writer')
    expect(switchRole).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith({ summary: 'Switch to the Author role. Your drafts are there', action: 'Switch' })

    const declined = await runTool(
      { id: '2', name: 'switch_role', args: { role: 'labeler', reason: 'Labels live there' } },
      context({ actions: actions(base), confirm: vi.fn(async () => false), onSwitched }),
    )
    expect(declined).toEqual({ status: 'cancelled' })

    const unsaved = await runTool(
      { id: '3', name: 'switch_role', args: { role: 'labeler', reason: 'Labels live there' } },
      context({ actions: actions({ ...base, confirmLeave: () => false }), confirm: vi.fn(async () => true), onSwitched: vi.fn() }),
    )
    expect(unsaved).toEqual({ status: 'cancelled' })
    expect(await runTool({ id: '4', name: 'switch_role', args: { role: 'teacher', reason: '' } }, context({ actions: actions(base), onSwitched }))).toMatchObject({
      status: 'error',
    })
    expect(
      await runTool({ id: '5', name: 'switch_role', args: { role: 'researcher', reason: 'back' } }, context({ actions: actions(base), onSwitched })),
    ).toMatchObject({ status: 'error' })
    expect(await runTool({ id: '6', name: 'switch_role', args: { role: 'labeler', reason: 'go' } }, context())).toMatchObject({ status: 'error' })
  })

  it('switch_role takes no inherited name, such as "constructor", for a role', async () => {
    const onSwitched = vi.fn()
    const switchRole = vi.fn()
    const confirm = vi.fn(async () => true)
    for (const role of ['constructor', 'toString', '__proto__']) {
      const call = { id: '1', name: 'switch_role', args: { role, reason: 'x' } }
      const result = await runTool(call, context({ actions: actions({ role: 'researcher', switchRole }), confirm, onSwitched }))
      expect(result).toMatchObject({ status: 'error' })
      expect(describeTool(call)).toBe(`Switching to the ${role} role`)
    }
    expect(confirm).not.toHaveBeenCalled()
    expect(onSwitched).not.toHaveBeenCalled()
    expect(switchRole).not.toHaveBeenCalled()
  })
})

describe('Do it', () => {
  beforeEach(() => {
    gateway.posts = []
    gateway.streams = []
    clearDoItConversation()
  })

  it('starts a new session when the carried one has ended', async () => {
    leaveDoItConversation({ lines: [], sessionId: 'old' })
    gateway.streams = [new Error('404: no such session'), [{ type: 'session', id: 's2' }, { type: 'say', text: 'Here is Home.' }, { type: 'done' }]]
    render(<DoIt actions={actions()} />)
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'Open Home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))

    expect(await screen.findByText('Here is Home.')).toBeInTheDocument()
    expect(gateway.posts.map((post) => post.body.session_id)).toEqual(['old', undefined])
    expect(peekDoItConversation()).toBeNull()
  })

  it('stops a carried run when Do it closes, and does not bring back a cleared conversation', async () => {
    leaveDoItConversation({ lines: [], sessionId: 's1' })
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'fill_field', args: { target: 'field:library-filter', text: 'late interaction' } }, { type: 'done' }],
    ]
    const { unmount } = render(
      <>
        <Screen />
        <DoIt actions={actions()} />
      </>,
    )
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'Filter it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))
    await screen.findByRole('group', { name: 'Approve this change' })

    // The role menu or sign-out clears the conversation, then this view goes away.
    clearDoItConversation()
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(peekDoItConversation()).toBeNull()
  })

  it('closing Do it while a change waits for Apply cancels it and sends nothing more', async () => {
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'fill_field', args: { target: 'field:library-filter', text: 'colbert' } }],
      [{ type: 'say', text: 'Filtered.' }, { type: 'done' }],
    ]
    render(<Screen />)
    const { result, unmount } = renderHook(() => useScreenAgent(actions(), vi.fn()))
    const sending = result.current.send('Filter my papers')
    await waitFor(() => expect(result.current.pending).not.toBeNull())
    const signal = vi.mocked(postEvents).mock.calls.at(-1)![3] as AbortSignal

    unmount()
    await sending // the waiting change answered Cancel, so the run ends instead of hanging
    expect(signal.aborted).toBe(true)
    expect(gateway.posts.map((post) => post.path)).toEqual(['/agent/runs'])
    expect(screen.getByText('Filter:')).toBeInTheDocument()
  })

  it('a run stopped before its change can show answers Cancel instead of waiting for ever', async () => {
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'fill_field', args: { target: 'field:library-filter', text: 'colbert' } }],
      [{ type: 'say', text: 'Filtered.' }, { type: 'done' }],
    ]
    render(<Screen />)
    // Stop lands after the tool started and before its approval card exists: the cursor's
    // "Fill this in?" comes just before the card.
    let stopRun = () => {}
    const point = vi.fn((pointing: Pointing | null) => {
      if (pointing?.tone === 'asks') stopRun()
    })
    const { result } = renderHook(() => useScreenAgent(actions(), point))
    stopRun = () => result.current.stop()

    await act(() => result.current.send('Filter my papers'))
    expect(result.current.pending).toBeNull()
    expect(gateway.posts.map((post) => post.path)).toEqual(['/agent/runs'])
    expect(screen.getByText('Filter:')).toBeInTheDocument()
  })

  it('names the Author agent’s server steps in words', async () => {
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'step', name: 'list_drafts' }, { type: 'step', name: 'draft_issues' }, { type: 'say', text: 'Two drafts.' }, { type: 'done' }],
    ]
    render(<DoIt actions={actions({ role: 'writer', examples: ['What drafts do I have?'] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'What drafts do I have?' }))

    expect(await screen.findByText('Two drafts.')).toBeInTheDocument()
    expect(screen.getByText('Looking through your drafts')).toBeInTheDocument()
    expect(screen.getByText('Reading what needs work in a draft')).toBeInTheDocument()
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

  it('Cancel on the Apply step changes nothing and tells the agent', async () => {
    gateway.streams = [
      [{ type: 'session', id: 's1' }, { type: 'tool', id: 'c1', name: 'fill_field', args: { target: 'field:library-filter', text: 'late interaction' } }, { type: 'done' }],
      [{ type: 'say', text: 'Left it as it was.' }, { type: 'done' }],
    ]
    render(
      <>
        <Screen />
        <DoIt actions={actions()} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show me where to search the library' }))

    const approve = await screen.findByRole('group', { name: 'Approve this change' })
    expect(approve).toHaveTextContent('Type “late interaction” into Filter papers.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Left it as it was.')).toBeInTheDocument()
    expect(screen.getByText('Filter:')).toBeInTheDocument()
    await waitFor(() => expect(gateway.posts[1].body).toMatchObject({ name: 'fill_field', result: { status: 'cancelled' } }))
  })

  it('a role switch asks first, then the same conversation carries on in the new role', async () => {
    function TwoRoles() {
      const [role, setRole] = useState<'researcher' | 'labeler'>('researcher')
      const shared = { openScreen: vi.fn(), openPaper: vi.fn(), switchRole: setRole }
      const current =
        role === 'researcher'
          ? { role, screen: 'library', screens: ['home', 'library'], ...shared }
          : { role, screen: 'papers', screens: ['papers'], ...shared }
      return (
        <>
          <p>Showing {role}</p>
          <DoIt key={role} actions={current} />
        </>
      )
    }
    gateway.streams = [
      [
        { type: 'session', id: 's1' },
        { type: 'tool', id: 'c1', name: 'switch_role', args: { role: 'labeler', reason: 'The claims to label are there' } },
        { type: 'done' },
      ],
      [{ type: 'say', text: 'Staying in the Researcher.' }, { type: 'done' }],
    ]
    render(
      <StrictMode>
        <TwoRoles />
      </StrictMode>,
    )
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'I want to label claims' } })
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))

    const approve = await screen.findByRole('group', { name: 'Approve this change' })
    expect(approve).toHaveTextContent('Switch to the Labeler role. The claims to label are there')
    expect(gateway.posts).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Staying in the Researcher.')).toBeInTheDocument()
    expect(screen.getByText('Showing researcher')).toBeInTheDocument()
    await waitFor(() => expect(gateway.posts[1].body).toMatchObject({ name: 'switch_role', role: 'researcher', result: { status: 'cancelled' } }))
  })

  it('Switch moves to the new role, whose agent goes on with the request in the same session', async () => {
    function TwoRoles() {
      const [role, setRole] = useState<'researcher' | 'labeler'>('researcher')
      const shared = { openScreen: vi.fn(), openPaper: vi.fn(), switchRole: setRole }
      const current =
        role === 'researcher'
          ? { role, screen: 'library', screens: ['home', 'library'], ...shared }
          : { role, screen: 'papers', screens: ['papers'], ...shared }
      return (
        <>
          <p>Showing {role}</p>
          <DoIt key={role} actions={current} />
        </>
      )
    }
    gateway.streams = [
      [
        { type: 'session', id: 's1' },
        { type: 'tool', id: 'c1', name: 'switch_role', args: { role: 'labeler', reason: 'The claims to label are there' } },
        { type: 'done' },
      ],
      [{ type: 'say', text: 'Switched to the Labeler.' }, { type: 'done' }],
      [{ type: 'session', id: 's1' }, { type: 'say', text: 'Here are the papers to label.' }, { type: 'done' }],
      [{ type: 'session', id: 's1' }, { type: 'say', text: 'The papers are listed.' }, { type: 'done' }],
    ]
    render(
      <StrictMode>
        <TwoRoles />
      </StrictMode>,
    )
    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'I want to label claims' } })
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Switch' }))

    expect(await screen.findByText('Showing labeler')).toBeInTheDocument()
    expect(screen.getByText('Switched to the Labeler.')).toBeInTheDocument()
    expect(screen.getByText('I want to label claims')).toBeInTheDocument()
    await waitFor(() => expect(gateway.posts[1].body).toMatchObject({ name: 'switch_role', role: 'researcher', result: { status: 'switched' } }))

    // The Labeler's agent picks up the request once, strict mode or not.
    expect(await screen.findByText('Here are the papers to label.')).toBeInTheDocument()
    expect(screen.getByText('Going on in this role')).toBeInTheDocument()
    expect(gateway.posts[2].body).toMatchObject({ role: 'labeler', screen: 'papers', session_id: 's1' })
    expect(peekDoItConversation()?.resume).toBeFalsy()

    fireEvent.change(screen.getByLabelText('What should the AI do?'), { target: { value: 'What is next?' } })
    fireEvent.submit(screen.getByLabelText('What should the AI do?').closest('form')!)
    expect(await screen.findByText('The papers are listed.')).toBeInTheDocument()
    expect(gateway.posts).toHaveLength(4)
    expect(gateway.posts[3].body).toMatchObject({ message: 'What is next?', role: 'labeler', screen: 'papers', session_id: 's1' })
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
