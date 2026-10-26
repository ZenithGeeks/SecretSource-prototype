/** After a refresh, Ask reopens the chat, panel and mode this signed-in user had (#745). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAsk } from '../src/components/Ask'
import {
  loadAskChat,
  loadAskMode,
  loadAskOpen,
  saveAskChat,
  saveAskMode,
  saveAskOpen,
  userIdFromStoredSession,
} from '../src/lib/askSession'

const auth = vi.hoisted(() => ({ userId: 'user-a' as string | null }))

vi.mock('../src/lib/useAuth', () => ({
  useAuth: () => ({ session: auth.userId ? { user: { id: auth.userId } } : null, loading: false }),
  endSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const STATEMENT = {
  index: 0,
  text: 'It is 6–10× smaller.',
  source: 'colbertv2.pdf',
  page: 9,
  verdict: 'supports' as const,
  quote: 'six to ten times',
  reasoning: 'The paper says so.',
}

type StoredMessage = { role: 'user'; text: string } | { role: 'assistant'; statements: (typeof STATEMENT)[] }

const saved = new Map<string, StoredMessage[]>()
let nextChat = 1

function sse(events: object[]) {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(payload, { status: 200 })
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/health')) return Response.json({ features: { ask: true, analyses: true } })
      if (url.endsWith('/analyses')) return Response.json([])
      if (url.endsWith('/assistant/chats') && init?.method === 'POST') {
        const id = `chat-${nextChat++}`
        saved.set(id, [])
        return Response.json({ id, title: '', updated: 0 })
      }
      if (url.endsWith('/assistant/chats')) return Response.json([])
      const messages = url.match(/\/assistant\/chats\/([^/]+)\/messages$/)
      if (messages && init?.method === 'POST') {
        const id = decodeURIComponent(messages[1])
        const body = JSON.parse(String(init.body)) as { question: string }
        const chat = saved.get(id) ?? []
        chat.push({ role: 'user', text: body.question }, { role: 'assistant', statements: [STATEMENT] })
        saved.set(id, chat)
        return sse([
          { type: 'statement', index: 0, text: STATEMENT.text, source: STATEMENT.source, page: STATEMENT.page },
          { type: 'verdict', index: 0, verdict: 'supports', quote: STATEMENT.quote, reasoning: STATEMENT.reasoning },
          { type: 'done', statements: 1 },
        ])
      }
      const chat = url.match(/\/assistant\/chats\/([^/]+)$/)
      if (chat) {
        const id = decodeURIComponent(chat[1])
        const messagesFor = saved.get(id)
        if (!messagesFor) return new Response('not found', { status: 404 })
        return Response.json({ messages: messagesFor })
      }
      return Response.json([])
    }),
  )
}

function Harness() {
  const ask = useAsk({
    role: 'researcher',
    screen: 'library',
    actions: { screen: 'library', screens: ['home', 'library'], openScreen: () => {}, openPaper: () => {} },
  })
  return (
    <>
      {ask.button}
      {ask.panel}
    </>
  )
}

function renderAsk() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
}

async function ask(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: question } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
}

beforeEach(() => {
  auth.userId = 'user-a'
  saved.clear()
  nextChat = 1
  installFetch()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the stored session', () => {
  it('reads a user id out of a Supabase session blob', () => {
    expect(userIdFromStoredSession(null)).toBeNull()
    expect(userIdFromStoredSession('not json')).toBeNull()
    expect(userIdFromStoredSession(JSON.stringify({ user: { id: 'user-a' } }))).toBe('user-a')
    expect(userIdFromStoredSession(JSON.stringify({ currentSession: { user: { id: 'user-b' } } }))).toBe('user-b')
    expect(userIdFromStoredSession(JSON.stringify({ user: { id: '' } }))).toBeNull()
  })

  it('keeps one account’s chat, panel and mode off the other account’s keys', () => {
    saveAskChat('user-a', 'chat-a')
    saveAskOpen('user-a', true)
    saveAskMode('user-a', 'answer')
    saveAskChat('user-b', 'chat-b')
    saveAskOpen('user-b', false)
    saveAskMode('user-b', 'do')

    expect(loadAskChat('user-a')).toBe('chat-a')
    expect(loadAskOpen('user-a')).toBe(true)
    expect(loadAskMode('user-a')).toBe('answer')
    expect(loadAskChat('user-b')).toBe('chat-b')
    expect(loadAskOpen('user-b')).toBe(false)
    expect(loadAskMode('user-b')).toBe('do')

    saveAskChat('user-a', null)
    expect(loadAskChat('user-a')).toBeNull()
    expect(loadAskChat('user-b')).toBe('chat-b')
    expect(loadAskMode('nope')).toBeNull()
  })

  it('treats a storage that throws as empty and does not throw on write', () => {
    const deny = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(deny)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(deny)

    expect(loadAskChat('user-a')).toBeNull()
    expect(loadAskOpen('user-a')).toBe(false)
    expect(loadAskMode('user-a')).toBeNull()
    expect(() => saveAskChat('user-a', 'chat-a')).not.toThrow()
    expect(() => saveAskOpen('user-a', true)).not.toThrow()
    expect(() => saveAskMode('user-a', 'do')).not.toThrow()
    expect(() => saveAskChat('user-a', null)).not.toThrow()
  })
})

describe('reopening Ask after a refresh', () => {
  it('reopens the same chat in the open panel, and New chat clears it', async () => {
    saveAskChat('someone-else', 'their-chat')
    const first = renderAsk()
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
    await ask('How much smaller is the ColBERTv2 index?')

    expect(await screen.findByText(STATEMENT.text)).toBeInTheDocument()
    expect(loadAskChat('user-a')).toBe('chat-1')
    expect(loadAskOpen('user-a')).toBe(true)
    expect(loadAskChat('someone-else')).toBe('their-chat')

    first.unmount()
    renderAsk()

    expect(await screen.findByText(STATEMENT.text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('complementary', { name: 'Ask' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(loadAskChat('user-a')).toBeNull()
    expect(loadAskChat('someone-else')).toBe('their-chat')
    expect(screen.getByRole('heading', { name: 'Ask about the papers in your library' })).toBeInTheDocument()
    expect(screen.queryByText(STATEMENT.text)).not.toBeInTheDocument()
  })

  it('falls back to a new chat when the saved chat is missing', async () => {
    saveAskChat('user-a', 'gone')
    saveAskChat('someone-else', 'their-chat')
    saveAskOpen('user-a', true)
    renderAsk()

    expect(await screen.findByRole('heading', { name: 'Ask about the papers in your library' })).toBeInTheDocument()
    expect(screen.queryByText('Opening this chat…')).not.toBeInTheDocument()
    expect(loadAskChat('user-a')).toBeNull()
    expect(loadAskChat('someone-else')).toBe('their-chat')
  })

  it('does not open the previous account’s chat for the next person', async () => {
    saved.set('chat-a', [
      { role: 'user', text: 'How much smaller is the ColBERTv2 index?' },
      { role: 'assistant', statements: [{ ...STATEMENT, text: 'Only the first account saved this.' }] },
    ])
    saveAskChat('user-a', 'chat-a')
    saveAskOpen('user-a', true)
    const view = renderAsk()
    expect(await screen.findByText('Only the first account saved this.')).toBeInTheDocument()

    auth.userId = 'user-b'
    saveAskOpen('user-b', true)
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Harness />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Ask about the papers in your library' })).toBeInTheDocument()
    expect(screen.queryByText('Only the first account saved this.')).not.toBeInTheDocument()
    expect(loadAskChat('user-a')).toBe('chat-a')
    expect(loadAskChat('user-b')).toBeNull()
  })

  it('restores Do it with an empty conversation, and the chat is still there on Answer', async () => {
    saved.set('chat-1', [
      { role: 'user', text: 'How much smaller is the ColBERTv2 index?' },
      { role: 'assistant', statements: [STATEMENT] },
    ])
    saveAskChat('user-a', 'chat-1')
    saveAskOpen('user-a', true)
    saveAskMode('user-a', 'do')
    const first = renderAsk()

    const modes = () => within(screen.getByRole('group', { name: 'What Ask does' }))
    expect(modes().getByRole('button', { name: 'Do it' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Tell the AI what to do, and watch it work.')).toBeInTheDocument()
    expect(screen.queryByText(STATEMENT.text)).not.toBeInTheDocument()

    first.unmount()
    renderAsk()

    expect(modes().getByRole('button', { name: 'Do it' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Tell the AI what to do, and watch it work.')).toBeInTheDocument()
    expect(screen.queryByText(STATEMENT.text)).not.toBeInTheDocument()

    fireEvent.click(modes().getByRole('button', { name: 'Answer' }))

    expect(await screen.findByText(STATEMENT.text)).toBeInTheDocument()
    expect(loadAskMode('user-a')).toBe('answer')
  })

  it('keeps the panel closed, then shows the saved chat when Ask is opened', async () => {
    saved.set('chat-1', [
      { role: 'user', text: 'How much smaller is the ColBERTv2 index?' },
      { role: 'assistant', statements: [STATEMENT] },
    ])
    saveAskChat('user-a', 'chat-1')
    saveAskOpen('user-a', false)
    renderAsk()

    expect(screen.queryByRole('complementary', { name: 'Ask' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
    expect(await screen.findByText(STATEMENT.text)).toBeInTheDocument()
    expect(loadAskOpen('user-a')).toBe(true)
  })

  it('still opens a new chat when storage throws', () => {
    saveAskChat('user-a', 'chat-1')
    saveAskOpen('user-a', true)
    const deny = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(deny)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(deny)

    renderAsk()

    expect(screen.queryByRole('complementary', { name: 'Ask' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    expect(screen.getByRole('complementary', { name: 'Ask' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ask about the papers in your library' })).toBeInTheDocument()
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'New chat' }))).not.toThrow()
  })
})
