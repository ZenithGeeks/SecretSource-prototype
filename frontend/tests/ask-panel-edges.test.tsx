/**
 * The Ask panel (components/AssistantPanel) drawn from chats the test builds by hand: the chat
 * list, the two ways a question can go unanswered, the Why card, the keyboard on a phone, the
 * modes, and what changes while Ask is offline.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ userId: null as string | null }))

vi.mock('../src/lib/useAuth', () => ({
  useAuth: () => ({ session: auth.userId ? { user: { id: auth.userId } } : null, loading: false }),
  endSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

import { AssistantPanel, type AskAbout } from '../src/components/AssistantPanel'
import { type Assistant, type Statement, type Turn } from '../src/lib/assistant'
import { saveAskMode } from '../src/lib/askSession'

const LIBRARY: AskAbout = { kind: 'library', label: 'your library' }
const PAPER: AskAbout = { kind: 'paper', label: 'Group Normalization' }
const NODE: AskAbout = { kind: 'node', label: 'Batch norm' }
const PHONE = '(max-width: 1023px)'

let chats: object[] | null = []
let features: object = { ask: true }
let offsetParent: { mockRestore: () => void } | undefined

beforeEach(() => {
  auth.userId = null
  chats = []
  features = { ask: true }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return Response.json({ features })
      if (url.endsWith('/assistant/chats')) return chats === null ? new Response('down', { status: 500 }) : Response.json(chats)
      return Response.json({})
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  offsetParent?.mockRestore()
  offsetParent = undefined
})

const statement = (over: Partial<Statement> = {}): Statement => ({ index: 0, text: 'BN uses batch statistics.', source: 'group-norm.pdf', ...over })
const turn = (over: Partial<Turn> = {}): Turn => ({ id: 1, question: 'Why?', statements: [], status: 'done', ...over })

function fakeAssistant(over: Partial<Assistant> = {}): Assistant {
  return {
    chatId: null,
    turns: [],
    answering: false,
    opening: false,
    openFailed: false,
    draft: '',
    setDraft: vi.fn(),
    ask: vi.fn(async () => {}),
    run: vi.fn(async () => {}),
    refuse: vi.fn(),
    stop: vi.fn(),
    newChat: vi.fn(),
    openChat: vi.fn(async () => {}),
    ...over,
  }
}

type PanelProps = Partial<React.ComponentProps<typeof AssistantPanel>> & { draft?: string }

/** The panel with a draft that really changes as the test types into it. */
function Panel({ draft: first = '', about = LIBRARY, ...props }: PanelProps & { assistant?: Assistant }) {
  const [draft, setDraft] = useState(first)
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const assistant = { ...(props.assistant ?? fakeAssistant()), draft, setDraft }
  return (
    <QueryClientProvider client={client}>
      <AssistantPanel
        role="researcher"
        context={{ screen: 'library' }}
        onClearAbout={() => {}}
        onClose={() => {}}
        onShowSource={() => {}}
        {...props}
        assistant={assistant}
        about={about}
      />
    </QueryClientProvider>
  )
}

const field = () => screen.getByRole('textbox', { name: 'Your question' })

describe('answers that need a word of explanation', () => {
  it('says what to do when a question about one paper gets no statements', () => {
    render(<Panel about={PAPER} assistant={fakeAssistant({ turns: [turn()] })} />)

    expect(screen.getByText('This paper does not answer this.')).toBeInTheDocument()
    expect(screen.getByText(/Remove the chip to ask your whole library/)).toBeInTheDocument()
  })

  it('shows what a command left as a note, and a result with no command name under a generic label', () => {
    const turns = [turn({ id: 1, note: '2 more sentences were not checked: the limit is 6.' }), turn({ id: 2, view: { kind: 'message', text: 'Nothing here.' } })]
    render(<Panel assistant={fakeAssistant({ turns })} />)

    expect(screen.getByText('2 more sentences were not checked: the limit is 6.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Result of command' })).toHaveTextContent('Nothing here.')
    expect(screen.queryByText('No paper in your library answers this.')).not.toBeInTheDocument()
  })

  it('gives a failed answer no Ask again once a newer turn has followed it', () => {
    const turns = [turn({ id: 1, status: 'failed' }), turn({ id: 2, question: 'Next?', statements: [statement()] })]
    render(<Panel assistant={fakeAssistant({ turns })} />)

    const failure = screen.getByText('The answer failed. Your question is kept in this chat.')
    expect(within(failure.closest('div')!).queryByRole('button', { name: 'Ask again' })).not.toBeInTheDocument()
    // Only the newest turn can be asked again, which its Copy / Ask again pill offers.
    expect(screen.getAllByRole('button', { name: 'Ask again' })).toHaveLength(1)
  })

  it('shows the opening message while a saved chat loads, and says when it could not be opened', () => {
    const { rerender } = render(<Panel assistant={fakeAssistant({ opening: true })} />)
    expect(screen.getByText('Opening this chat…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ask about the papers in your library' })).not.toBeInTheDocument()

    rerender(<Panel assistant={fakeAssistant({ openFailed: true })} />)
    expect(screen.getByText('This chat could not be opened.')).toBeInTheDocument()
  })
})

describe('a checked statement', () => {
  const verdict = { verdict: 'refutes' as const, quote: 'GN error stays stable.', reasoning: 'BN still trains at 8.' }

  it('opens the Why card with no page when the judge named none, and the passage from there', () => {
    const onShowSource = vi.fn()
    render(<Panel onShowSource={onShowSource} assistant={fakeAssistant({ turns: [turn({ statements: [statement(verdict)] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Contradicted: why' }))
    expect(screen.getByText('What the passage says')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open passage' }))

    expect(onShowSource).toHaveBeenCalledWith({ paper: 'group-norm.pdf', label: 'group-norm', source: null, page: undefined, quote: 'GN error stays stable.' })
  })

  it('opens the source from the line under the statement', () => {
    const onShowSource = vi.fn()
    render(<Panel onShowSource={onShowSource} titles={{ 'group-norm.pdf': 'Group Normalization' }} assistant={fakeAssistant({ turns: [turn({ statements: [statement({ page: 6 })] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Group Normalization · p. 6' }))

    expect(onShowSource).toHaveBeenCalledWith(expect.objectContaining({ paper: 'group-norm.pdf', page: 6 }))
  })

  it('copies a statement with no source, and one the judge never checked', async () => {
    render(<Panel assistant={fakeAssistant({ turns: [turn({ statements: [statement({ source: '' }), statement({ index: 1, text: 'Second.' })] })] })} />)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy' })))

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('Why?\n\n- BN uses batch statistics. [Not checked]\n- Second. (group-norm) [Not checked]')
  })

  it('counts a single contradicted check in the summary of a finished answer', () => {
    const statements = [statement({ verdict: 'supports' }), statement({ index: 1, verdict: 'refutes' })]
    render(<Panel assistant={fakeAssistant({ turns: [turn({ statements })] })} />)

    expect(screen.getByText('Answer · 1 of 2 backed · 1 contradicted')).toBeInTheDocument()
  })
})

describe('the chat list', () => {
  it('lists chats, with a name for one that has no title, and opens one', async () => {
    chats = [{ id: 'c1', title: '', updated: 0 }]
    const assistant = fakeAssistant()
    render(<Panel assistant={assistant} />)

    fireEvent.click(screen.getByRole('button', { name: 'Your chats' }))
    fireEvent.click(await screen.findByRole('button', { name: /Untitled chat/ }))

    expect(assistant.openChat).toHaveBeenCalledWith('c1')
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeInTheDocument()
  })

  it('says there are none yet, and starts a new one from the list', async () => {
    const assistant = fakeAssistant()
    render(<Panel assistant={assistant} />)

    fireEvent.click(screen.getByRole('button', { name: 'Your chats' }))
    expect(await screen.findByText('No chats yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(assistant.newChat).toHaveBeenCalled()
    expect(field()).toBeInTheDocument()
  })

  it('says the chats could not be loaded, and goes back to the chat', async () => {
    chats = null
    render(<Panel />)

    fireEvent.click(screen.getByRole('button', { name: 'Your chats' }))
    expect(await screen.findByText('Your chats could not be loaded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))

    expect(field()).toBeInTheDocument()
  })
})

describe('the composer', () => {
  it('words the field for a paper, a node and the library', () => {
    const { rerender } = render(<Panel about={PAPER} />)
    expect(field()).toHaveAttribute('placeholder', 'Ask about this paper, / for commands…')

    rerender(<Panel about={NODE} />)
    expect(field()).toHaveAttribute('placeholder', 'Ask about this node, / for commands…')
  })

  it('types @ after a draft that already ends in a space, and a slash into an empty field', () => {
    const { unmount } = render(<Panel draft="compare " />)
    fireEvent.click(screen.getByRole('button', { name: '@ Paper' }))
    expect(field()).toHaveValue('compare @')
    unmount()

    render(<Panel />)
    fireEvent.click(screen.getByRole('button', { name: '/ Commands' }))
    expect(field()).toHaveValue('/')
  })

  it('types @ into an empty field', () => {
    render(<Panel />)

    fireEvent.click(screen.getByRole('button', { name: '@ Paper' }))

    expect(field()).toHaveValue('@')
  })

  it('sends nothing for an empty field, or while an answer is coming', () => {
    const idle = fakeAssistant()
    const { unmount } = render(<Panel assistant={idle} />)
    fireEvent.submit(field().closest('form')!)
    expect(idle.ask).not.toHaveBeenCalled()
    unmount()

    const busy = fakeAssistant({ answering: true, turns: [turn({ status: 'answering' })] })
    render(<Panel draft="Another question" assistant={busy} />)
    fireEvent.submit(field().closest('form')!)
    expect(busy.ask).not.toHaveBeenCalled()
    expect(field()).toHaveValue('Another question')
  })
})

describe('while Ask is offline', () => {
  beforeEach(() => {
    features = { ask: false }
  })

  it('says why, ignores a starter question, and offers no Ask again', async () => {
    const assistant = fakeAssistant()
    const { unmount } = render(<Panel about={PAPER} assistant={assistant} />)
    expect(await screen.findByText(/The library search is offline/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'What are its main results?' }))
    expect(assistant.ask).not.toHaveBeenCalled()
    unmount()

    render(<Panel assistant={fakeAssistant({ turns: [turn({ status: 'failed' })] })} />)
    await screen.findByText(/The library search is offline/)
    expect(screen.queryByRole('button', { name: 'Ask again' })).not.toBeInTheDocument()
  })

  it('still runs a /command, and does not send a question', async () => {
    const assistant = fakeAssistant()
    const { unmount } = render(<Panel draft="/get_gaps" assistant={assistant} />)
    await screen.findByText(/The library search is offline/)

    fireEvent.submit(field().closest('form')!)
    expect(assistant.run).toHaveBeenCalledWith('/get_gaps', { name: 'get_gaps', args: {} })
    unmount()

    const question = fakeAssistant()
    render(<Panel draft="Why?" assistant={question} />)
    await screen.findByText(/The library search is offline/)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.submit(field().closest('form')!)
    expect(question.ask).not.toHaveBeenCalled()
  })
})

describe('modes', () => {
  const extra = { label: 'This claim', content: <p>Claim review</p> }

  it('opens on the screen’s own mode, and has no Do it when the role has none', () => {
    render(<Panel extra={extra} />)

    expect(screen.getByText('Claim review')).toBeInTheDocument()
    const modes = within(screen.getByRole('group', { name: 'What Ask does' }))
    expect(modes.getByRole('button', { name: 'This claim' })).toHaveAttribute('aria-pressed', 'true')
    expect(modes.queryByRole('button', { name: 'Do it' })).not.toBeInTheDocument()
  })

  it('falls back to Answer when the saved mode is one this screen does not have', () => {
    saveAskMode(null, 'do')
    render(<Panel />)

    expect(field()).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'What Ask does' })).not.toBeInTheDocument()
  })

  it('follows another account to the screen’s own mode, or to the mode that account chose', () => {
    auth.userId = 'ann'
    const view = render(<Panel extra={extra} />)
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(field()).toBeInTheDocument()

    auth.userId = 'bob'
    view.rerender(<Panel extra={extra} />)
    expect(screen.getByText('Claim review')).toBeInTheDocument()

    saveAskMode('cy', 'answer')
    auth.userId = 'cy'
    view.rerender(<Panel extra={extra} />)
    expect(field()).toBeInTheDocument()
  })
})

describe('the cursor', () => {
  it('rests on the last check a moment after an answer ends, then leaves', async () => {
    vi.useFakeTimers()
    render(<Panel assistant={fakeAssistant({ turns: [turn({ statements: [statement({ verdict: 'supports', quote: 'q' })], lastChecked: 0 })] })} />)

    // The cursor measures its target on the next frame.
    await act(async () => void vi.advanceTimersByTime(20))
    expect(screen.getByText('Looks right')).toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(2500))
    await act(async () => void vi.advanceTimersByTime(500))

    expect(screen.queryByText('Looks right')).not.toBeInTheDocument()
  })
})

describe('Tab on a phone', () => {
  function onPhone(matches: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query === PHONE, addEventListener() {}, removeEventListener() {} }))
    // jsdom has no layout, so nothing has an offsetParent and no control would count as shown.
    offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
  }
  // Not by role: on a phone the panel calls itself a dialog.
  const panel = () => document.querySelector('aside')!
  const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey })

  it('announces the panel as a dialog, and wraps Tab and Shift+Tab around its controls', () => {
    onPhone(true)
    render(<Panel />)
    const controls = [...panel().querySelectorAll<HTMLElement>('button:not([disabled]), input')]
    const first = controls[0]
    const last = controls.at(-1)!

    expect(panel()).toHaveAttribute('role', 'dialog')
    expect(panel()).toHaveAttribute('aria-modal', 'true')

    first.focus()
    expect(tab(true)).toBe(false)
    expect(last).toHaveFocus()
    expect(tab()).toBe(false)
    expect(first).toHaveFocus()
  })

  it('lets Tab move on inside the panel', () => {
    onPhone(true)
    render(<Panel />)
    const controls = [...panel().querySelectorAll<HTMLElement>('button:not([disabled]), input')]

    controls[1].focus()
    expect(tab()).toBe(true)
    expect(tab(true)).toBe(true)
    controls[0].focus()
    expect(tab()).toBe(true)
  })

  it('leaves other keys, and Tab on a desktop, alone', () => {
    onPhone(true)
    const { unmount } = render(<Panel />)
    panel().querySelector<HTMLElement>('button')!.focus()
    expect(fireEvent.keyDown(document.activeElement!, { key: 'a', shiftKey: true })).toBe(true)
    unmount()

    onPhone(false)
    render(<Panel />)
    expect(panel()).not.toHaveAttribute('role', 'dialog')
    panel().querySelector<HTMLElement>('button')!.focus()
    expect(tab(true)).toBe(true)
  })
})
