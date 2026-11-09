/**
 * useAsk (components/Ask) as a role app uses it: the chip for the open paper or graph node and
 * how it is removed, a source opened from an answer with its quote found on the page, and the Do it
 * mode with the way to connect a coding agent.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('../src/lib/useAuthorizedUrl', () => ({ useAuthorizedUrl: () => ({ url: 'blob:paper', failed: false }) }))
vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  followEvents: vi.fn(() => () => {}),
}))

import { useAsk, type AskNode } from '../src/components/Ask'
import { saveAskChat, saveAskOpen } from '../src/lib/askSession'
import { leaveDoItConversation } from '../src/lib/doItConversation'
import type { Statement } from '../src/lib/assistant'

const ANALYSES = [
  { id: 'a1', file: 'colbert_server/papers/colbertv2.pdf', title: 'ColBERTv2: Effective and Efficient Retrieval' },
  { id: 'a2', file: 'colbert_server/papers/untitled.pdf' },
]

type Find = { page: number | null; boxes: unknown[] }
let finds: ((url: URL) => Find | Response)[] = []
let saved: Statement[] = []
let findCalls: URL[] = []

beforeEach(() => {
  finds = []
  saved = []
  findCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = new URL(String(input), 'http://gateway.test')
      if (url.pathname.endsWith('/health')) return Response.json({ features: { ask: true } })
      if (url.pathname.endsWith('/analyses')) return Response.json(ANALYSES)
      if (url.pathname.endsWith('/find')) {
        findCalls.push(url)
        const answer = (finds.shift() ?? (() => ({ page: null, boxes: [] })))(url)
        return answer instanceof Response ? answer : Response.json(answer)
      }
      if (url.pathname.endsWith('/assistant/chats/c1')) {
        return Response.json({ messages: [{ role: 'user', text: 'Why?' }, { role: 'assistant', statements: saved }] })
      }
      return Response.json([])
    }),
  )
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
})

afterEach(() => vi.unstubAllGlobals())

type Props = Parameters<typeof useAsk>[0]

function Harness(props: Partial<Props>) {
  const ask = useAsk({ role: 'researcher', screen: 'library', ...props })
  return (
    <>
      {ask.button}
      {ask.panel}
      {ask.viewer}
    </>
  )
}

function renderAsk(props: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (next: Partial<Props>) => (
    <QueryClientProvider client={client}>
      <Harness {...next} />
    </QueryClientProvider>
  )
  const view = render(ui(props))
  return { ...view, rerenderAsk: (next: Partial<Props>) => view.rerender(ui(next)) }
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
}

describe('the chip for what the screen shows', () => {
  it('names the open paper by its short title, and asks the whole library once it is removed', async () => {
    renderAsk({ analysis: 'a1', analysisFile: 'colbert_server/papers/colbertv2.pdf' })
    openPanel()

    expect(await screen.findByText('About: ColBERTv2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveTextContent('about this paper')
    fireEvent.click(screen.getByRole('button', { name: 'Ask about your whole library instead' }))

    expect(screen.getByText('About: your library')).toBeInTheDocument()
  })

  it('brings the chip back when a different paper is opened', async () => {
    const { rerenderAsk } = renderAsk({ analysis: 'a1', analysisFile: 'colbert_server/papers/colbertv2.pdf' })
    openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about your whole library instead' }))

    rerenderAsk({ analysis: 'a2', analysisFile: 'colbert_server/papers/untitled.pdf' })

    expect(screen.getByText('About: colbert_server/papers/untitled.pdf')).toBeInTheDocument()
  })

  it('calls a paper with no known file "this paper"', async () => {
    renderAsk({ analysis: 'a2' })
    openPanel()

    expect(await screen.findByText('About: this paper')).toBeInTheDocument()
  })

  it('names the selected graph node, and drops it when removed', async () => {
    const node: AskNode = { id: 'n1', label: 'Batch norm' }
    const { rerenderAsk } = renderAsk({ node })
    openPanel()

    expect(await screen.findByText('About: Batch norm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about your whole library instead' }))
    expect(screen.getByText('About: your library')).toBeInTheDocument()

    rerenderAsk({ node: { id: 'n2', label: 'Group norm' } })
    expect(screen.getByText('About: Group norm')).toBeInTheDocument()
  })

  it('prefers the open paper to a selected node, and puts the scope in the button when given one', async () => {
    renderAsk({ analysis: 'a1', analysisFile: 'colbert_server/papers/colbertv2.pdf', node: { id: 'n1', label: 'Batch norm' }, scope: 'about this draft' })
    openPanel()

    expect(await screen.findByText('About: ColBERTv2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveTextContent('about this draft')
  })
})

describe('opening a source from an answer', () => {
  const cited: Statement = { index: 0, text: 'BN uses batch statistics.', source: 'colbertv2.pdf', page: 3, verdict: 'refutes', quote: 'Short bit…a much longer piece of the passage', reasoning: 'r' }

  async function openSource(statement: Statement, name: string) {
    saved = [statement]
    saveAskChat(null, 'c1')
    saveAskOpen(null, true)
    renderAsk()
    fireEvent.click(await screen.findByRole('button', { name }))
  }

  it('looks the longest piece of the quote up on its page and opens the paper there', async () => {
    finds = [() => ({ page: 3, boxes: [] })]
    await openSource(cited, 'ColBERTv2 · p. 3')

    expect(await screen.findByRole('heading', { name: 'Quoted passage · page 3' })).toBeInTheDocument()
    expect(findCalls).toHaveLength(1)
    expect(findCalls[0].searchParams.get('q')).toBe('a much longer piece of the passage')
    expect(findCalls[0].searchParams.get('page')).toBe('3')

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('looks in the whole paper when the quote is not on its page', async () => {
    finds = [() => ({ page: null, boxes: [] }), () => ({ page: 7, boxes: [] })]
    await openSource({ ...cited, quote: 'The long piece comes first…tiny' }, 'ColBERTv2 · p. 3')

    expect(await screen.findByRole('heading', { name: 'Quoted passage · page 7' })).toBeInTheDocument()
    expect(findCalls.map((call) => call.searchParams.get('page'))).toEqual(['3', null])
    expect(findCalls[0].searchParams.get('q')).toBe('The long piece comes first')
  })

  it('opens the cited page when the quote is found nowhere, or the lookup fails', async () => {
    finds = [() => new Response('down', { status: 500 }), () => new Response('down', { status: 500 })]
    await openSource(cited, 'ColBERTv2 · p. 3')

    expect(await screen.findByRole('heading', { name: 'Quoted passage · page 3' })).toBeInTheDocument()
    expect(findCalls).toHaveLength(2)
  })

  it('does not look again when the statement cited no page', async () => {
    finds = [() => ({ page: null, boxes: [] })]
    await openSource({ ...cited, page: undefined }, 'ColBERTv2')

    await screen.findByRole('dialog')
    expect(findCalls).toHaveLength(1)
  })

  it('opens the paper without a lookup when there is no quote to find', async () => {
    await openSource({ index: 0, text: 'Unchecked.', source: 'colbertv2.pdf', page: 3 }, 'ColBERTv2 · p. 3')

    await screen.findByRole('dialog')
    expect(findCalls).toHaveLength(0)
  })
})

describe('Do it', () => {
  const actions = { screen: 'library', screens: ['home', 'library'], openScreen: vi.fn(), openPaper: vi.fn() }

  it('offers to connect a coding agent, and opens the connect screen from there', async () => {
    renderAsk({ actions })
    openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Do it' }))

    fireEvent.click(screen.getByRole('button', { name: /Work from your terminal/ }))

    expect(screen.getByRole('dialog', { name: 'Let your coding agent use this tab' })).toBeInTheDocument()
  })

  it('does not offer to connect once an agent is connected', async () => {
    window.sessionStorage.setItem('agentBridge.connected', '1')
    renderAsk({ actions })
    openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Do it' }))

    expect(screen.queryByRole('button', { name: /Work from your terminal/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agent/ })).toBeInTheDocument()
  })

  it('opens on Do it, whatever was saved, when a role switch carried a conversation here', async () => {
    leaveDoItConversation({ lines: [], sessionId: 's1' })
    renderAsk({ actions })

    expect(await screen.findByText('Tell the AI what to do, and watch it work.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('aria-pressed', 'true')
  })
})
