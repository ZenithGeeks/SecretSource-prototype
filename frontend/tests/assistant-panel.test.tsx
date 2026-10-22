/**
 * The Ask panel (#534): statements stream in with a Checking… stamp that turns into the judge's
 * verdict, a stamp opens the judge's passage and reasoning, Stop keeps what arrived, and the
 * empty, no-answer, failed and chat-list states.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantPanel, type AskAbout } from '../src/components/AssistantPanel'
import type { Target } from '../src/components/PageViewer'
import { type AskContext, useAssistant, whenLabel } from '../src/lib/assistant'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const encoder = new TextEncoder()

/** A stream the test feeds one server-sent event at a time. */
function controlledStream() {
  let feed!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (controller) => void (feed = controller) })
  return {
    response: new Response(body, { status: 200 }),
    send: (event: object) => act(async () => feed.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))),
    end: () => act(async () => feed.close()),
  }
}

/** Answers the chat routes; the question's events come from `stream`. */
function gateway(stream: ReturnType<typeof controlledStream>, chats: object[] = [], chat: object = { messages: [] }) {
  const calls: { url: string; body?: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/messages')) return stream.response
      if (url.endsWith('/assistant/chats') && init?.method === 'POST') return Response.json({ id: 'chat1', title: '', updated: 0 })
      if (url.endsWith('/assistant/chats')) return Response.json(chats)
      return Response.json(chat)
    }),
  )
  return calls
}

const LIBRARY: AskAbout = { kind: 'library', label: 'your library' }
const PAPER: AskAbout = { kind: 'paper', label: 'Group Normalization' }

function Panel({ about = LIBRARY, context = { screen: 'library' }, onShowSource = () => {}, onClearAbout = () => {} }: {
  about?: AskAbout
  context?: AskContext
  onShowSource?: (target: Target) => void
  onClearAbout?: () => void
}) {
  const assistant = useAssistant()
  return (
    <AssistantPanel
      role="researcher"
      assistant={assistant}
      context={context}
      about={about}
      onClearAbout={onClearAbout}
      onClose={() => {}}
      onShowSource={onShowSource}
    />
  )
}

async function ask(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: question } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
}

const statement = (index: number, text: string, page = 6) => ({
  type: 'statement',
  index,
  text,
  source: 'group-norm-2018.pdf',
  page,
})

describe('the Ask panel', () => {
  it("moves the AI cursor from the question to each statement as its check comes in, reacting to the verdict", async () => {
    const stream = controlledStream()
    gateway(stream)
    render(<Panel />)

    await ask('Why does batch norm fail with small batches?')
    expect(await screen.findByText('Reading…')).toBeInTheDocument()
    await stream.send(statement(0, 'BN normalizes with the batch mean.', 1))
    await stream.send({ type: 'verdict', index: 0, verdict: 'refutes', quote: '', reasoning: '' })
    expect(await screen.findByText('Check this')).toBeInTheDocument()
    await stream.send(statement(1, 'BN stops working below 8 images.'))
    await stream.send({ type: 'verdict', index: 1, verdict: 'supports', quote: '', reasoning: '' })
    expect(await screen.findByText('Looks right')).toBeInTheDocument()
    // The cursor is a picture of what the stamps already say, so screen readers skip it.
    expect(screen.getByText('Looks right').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('stamps each statement Checking… until its verdict arrives', async () => {
    const stream = controlledStream()
    const calls = gateway(stream)
    render(<Panel about={PAPER} context={{ screen: 'analyses', analysis: 'a1' }} />)

    await ask('Why does batch norm fail with small batches?')
    await stream.send(statement(0, 'BN normalizes with the batch mean.', 1))
    await stream.send(statement(1, 'BN stops working below 8 images.'))

    expect(screen.getAllByText('Checking…')).toHaveLength(2)
    expect(screen.getByText(/Answer · Checking 1 of 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'group-norm-2018 · p. 1' })).toBeInTheDocument()

    await stream.send({ type: 'verdict', index: 1, verdict: 'refutes', quote: 'GN error stays stable.', reasoning: 'BN still trains at 8.' })
    await stream.send({ type: 'verdict', index: 0, verdict: 'supports', quote: 'BN uses batch statistics.', reasoning: 'Stated on page 1.' })
    await stream.send({ type: 'done', statements: 2 })

    expect(screen.getByText(/Answer · 1 of 2 backed · 1 contradicted/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Backed: why' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contradicted: why' })).toBeInTheDocument()
    expect(calls.find((c) => c.url.endsWith('/messages'))?.body).toEqual({
      question: 'Why does batch norm fail with small batches?',
      context: { screen: 'analyses', analysis: 'a1' },
    })
  })

  it('names the two other verdicts Not backed and Can’t check', async () => {
    const stream = controlledStream()
    gateway(stream)
    render(<Panel />)

    await ask('q')
    await stream.send(statement(0, 'The index is 30 times smaller.'))
    await stream.send({ ...statement(1, 'The 2019 release had no compression.'), source: '', page: undefined })
    await stream.send({ type: 'verdict', index: 0, verdict: 'insufficient', quote: '', reasoning: 'No passage gives the factor.' })
    await stream.send({ type: 'verdict', index: 1, verdict: 'unchecked', quote: '', reasoning: '' })

    expect(screen.getByText('Not backed')).toBeInTheDocument()
    expect(screen.getByText('Can’t check')).toBeInTheDocument()
    expect(screen.getByText('No passage named')).toBeInTheDocument()
  })

  it('opens the judge’s passage and reasoning from a stamp, and the passage from there', async () => {
    const stream = controlledStream()
    gateway(stream)
    const onShowSource = vi.fn()
    render(<Panel onShowSource={onShowSource} />)

    await ask('q')
    await stream.send(statement(0, 'BN stops working below 8 images.'))
    await stream.send({ type: 'verdict', index: 0, verdict: 'refutes', quote: 'GN error stays stable.', reasoning: 'BN still trains at 8.' })
    fireEvent.click(screen.getByRole('button', { name: 'Contradicted: why' }))

    expect(screen.getByText('What the passage says · page 6')).toBeInTheDocument()
    expect(screen.getByText('“GN error stays stable.”')).toBeInTheDocument()
    expect(screen.getByText('BN still trains at 8.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open passage' }))
    expect(onShowSource).toHaveBeenCalledWith(expect.objectContaining({ paper: 'group-norm-2018.pdf', page: 6 }))
  })

  it('turns Send into Stop while answering, and Stop keeps what arrived', async () => {
    const stream = controlledStream()
    gateway(stream)
    render(<Panel />)

    await ask('q')
    await stream.send(statement(0, 'BN normalizes with the batch mean.'))
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })))

    expect(screen.getByText('BN normalizes with the batch mean.')).toBeInTheDocument()
    expect(screen.getByText('Stopped. What arrived is kept.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    // Its check never finished, so it is not still Checking…, and a late verdict changes nothing.
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
    expect(screen.getByText('Can’t check')).toBeInTheDocument()
    await stream.send({ type: 'verdict', index: 0, verdict: 'supports', quote: 'q', reasoning: 'r' })
    expect(screen.queryByText('Backed')).not.toBeInTheDocument()
  })

  it('says when no paper answers the question', async () => {
    const stream = controlledStream()
    gateway(stream)
    render(<Panel />)

    await ask('What does the 2023 Gemini report say?')
    await stream.send({ type: 'done', statements: 0 })

    expect(screen.getByText('No paper in your library answers this.')).toBeInTheDocument()
  })

  it('keeps a failed question and offers to ask it again', async () => {
    const stream = controlledStream()
    const calls = gateway(stream)
    render(<Panel />)

    await ask('Which datasets?')
    await stream.send({ type: 'error', message: 'the answer failed, ask again' })

    expect(screen.getByText('The answer failed. Your question is kept in this chat.')).toBeInTheDocument()
    const again = controlledStream()
    const retried = gateway(again)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask again' })))
    expect(calls.filter((c) => c.url.endsWith('/assistant/chats') && c.body)).toHaveLength(1) // the chat was made once
    expect(retried.map((c) => c.url)).toEqual([expect.stringMatching(/\/assistant\/chats\/chat1\/messages$/)])
    // The question shows once: the new answer takes the failed one's place.
    expect(screen.getAllByText('Which datasets?')).toHaveLength(1)
    expect(screen.queryByText('The answer failed. Your question is kept in this chat.')).not.toBeInTheDocument()
  })

  it('starts empty, with a chip that asks the whole library once removed', () => {
    const onClearAbout = vi.fn()
    const { unmount } = render(<Panel about={PAPER} onClearAbout={onClearAbout} />)

    expect(screen.getByText('About: Group Normalization')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about your whole library instead' }))
    expect(onClearAbout).toHaveBeenCalled()
    unmount()

    render(<Panel />)
    expect(screen.getByRole('heading', { name: 'Ask about the papers in your library' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask about your whole library instead' })).not.toBeInTheDocument()
  })

  it('asks a starter question from the empty panel', async () => {
    const calls = gateway(controlledStream())
    render(<Panel about={PAPER} />)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'What are its main results?' })))

    await waitFor(() => expect(calls.some((call) => JSON.stringify(call.body ?? '').includes('What are its main results?'))).toBe(true))
    expect(screen.queryByRole('button', { name: 'What limits does it admit?' })).not.toBeInTheDocument()
  })

  it('lists earlier chats and opens one with its checked reply', async () => {
    gateway(controlledStream(), [{ id: 'c7', title: 'How much smaller is the ColBERTv2 index?', updated: 0 }], {
      messages: [
        { role: 'user', text: 'How much smaller is the ColBERTv2 index?' },
        { role: 'assistant', statements: [{ index: 0, text: 'It is 6–10× smaller.', source: 'colbertv2.pdf', page: 9, verdict: 'supports', quote: 'q', reasoning: 'r' }] },
      ],
    })
    render(<Panel />)

    fireEvent.click(screen.getByRole('button', { name: 'Your chats' }))
    const chat = await screen.findByRole('button', { name: /ColBERTv2 index/ })
    await act(async () => fireEvent.click(chat))

    expect(await screen.findByText('It is 6–10× smaller.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Backed: why' })).toBeInTheDocument()
  })
})

describe('whenLabel', () => {
  const now = new Date(2026, 9, 20, 21, 0)
  it('says today with the time, yesterday, or the date', () => {
    expect(whenLabel(new Date(2026, 9, 20, 19, 5).getTime() / 1000, now)).toBe('Today, 19:05')
    expect(whenLabel(new Date(2026, 9, 19, 9, 0).getTime() / 1000, now)).toBe('Yesterday')
    expect(whenLabel(new Date(2026, 9, 17, 9, 0).getTime() / 1000, now)).toBe('17 Oct')
  })
})
