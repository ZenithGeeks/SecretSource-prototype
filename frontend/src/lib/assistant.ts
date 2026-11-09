/**
 * The assistant's chats (backend/README.md "Assistant"): questions about the reader's papers,
 * answered as short statements that the judge checks one by one. `useAssistant` holds the open
 * chat for the whole researcher app, so it survives a screen change and an answer keeps
 * streaming while the reader moves around. The open chat id is also kept for this signed-in
 * user (lib/askSession), so a refresh reopens it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Target } from '../components/PageViewer'
import { postEvents, request } from './api'
import { describeResult, type CommandView, type Parsed } from './askCommands'
import { loadAskChat, saveAskChat, useAskUserId } from './askSession'

/** What the question is about: the screen it was asked on, and the analysis or graph node there. */
export type AskContext = { screen: string; analysis?: string; node?: string }

/** A statement's check: the judge's verdict, `unchecked` when it named no passage, `error` when
 * the check failed. Missing while the check runs. */
export type StatementVerdict = 'supports' | 'refutes' | 'insufficient' | 'unchecked' | 'error'

export type Statement = {
  index: number
  text: string
  source: string // the PDF the statement cites
  page?: number // of the passage, when the answer named one
  verdict?: StatementVerdict
  quote?: string
  reasoning?: string
}

/** One question and its answer. `failed`: the answer broke off, the question stays in the chat.
 * `stopped`: the reader pressed Stop, what arrived stays. */
export type Turn = {
  id: number // stable for React keys, and so an answer's events find their own turn
  question: string
  statements: Statement[]
  status: 'answering' | 'done' | 'failed' | 'stopped'
  /** The statement whose check came in last, where the AI cursor points (components/AiCursor). */
  lastChecked?: number
  /** What a /command (lib/askCommands) answered when it is not statements, and the command's name. */
  view?: CommandView
  command?: string
  note?: string
}

let nextTurnId = 0

export type ChatSummary = { id: string; title: string; updated: number }

type ChatMessage = { role: 'user'; text: string } | { role: 'assistant'; statements: Statement[] }

export type AnswerEvent =
  | ({ type: 'statement' } & Pick<Statement, 'index' | 'text' | 'source' | 'page'>)
  // `page` comes only when the statement had none: the page of the passage the judge quoted.
  | ({ type: 'verdict' } & Required<Pick<Statement, 'index' | 'verdict' | 'quote' | 'reasoning'>> & Pick<Statement, 'page'>)
  | { type: 'done'; statements: number }
  | { type: 'error'; message: string }

export const listChats = () => request<ChatSummary[]>('/assistant/chats')

/** A saved chat as turns: each question with the reply after it. A question with no reply
 * (the answer failed, or the reader left first) shows as failed. */
export async function loadChat(id: string): Promise<Turn[]> {
  const chat = await request<{ messages: ChatMessage[] }>(`/assistant/chats/${encodeURIComponent(id)}`)
  const turns: Turn[] = []
  for (const message of chat.messages) {
    if (message.role === 'user') turns.push({ id: nextTurnId++, question: message.text, statements: [], status: 'failed' })
    else if (turns.length) turns[turns.length - 1] = { ...turns[turns.length - 1], statements: message.statements, status: 'done' }
  }
  return turns
}

/** The answer so far with one more event applied. */
function applyEvent(turn: Turn, event: AnswerEvent): Turn {
  switch (event.type) {
    case 'statement': {
      const { type: _, ...statement } = event
      return { ...turn, statements: [...turn.statements, statement] }
    }
    case 'verdict': {
      const { type: _, ...check } = event
      const statements = turn.statements.map((s) => (s.index === check.index ? { ...s, ...check } : s))
      return { ...turn, statements, lastChecked: check.index }
    }
    case 'done':
      return { ...turn, status: 'done' }
    case 'error':
      return { ...turn, status: 'failed' }
  }
}

/** "Group Normalization · p. 6": the paper's title when we know it, else its file name, and the
 * passage's page. */
export function sourceLabel(statement: Statement, title?: string) {
  const name = title || statement.source.replace(/\.pdf$/i, '')
  return statement.page ? `${name} · p. ${statement.page}` : name
}

/** The page a statement cites, for the page viewer. */
export function sourceTarget(statement: Statement, title?: string): Target {
  return {
    paper: statement.source,
    label: sourceLabel(statement, title),
    source: null,
    page: statement.page,
    quote: statement.quote || undefined,
  }
}

/** "InstructBLIP" from "InstructBLIP: Towards General-purpose Vision-Language Models", which
 * fits on a source line and in the chip. */
export function shortTitle(title: string) {
  return title.split(':')[0].trim() || title
}

/** "Today, 19:05", "Yesterday", "17 Oct" from a Unix time in seconds. */
export function whenLabel(seconds: number, now = new Date()) {
  const date = new Date(seconds * 1000)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function useAssistant() {
  const userId = useAskUserId()
  // Saves start only after the stored chat has been read, so the first empty state cannot
  // wipe it. A private window, or a load that fails, leaves the reader on a new chat.
  const hydrated = useRef(false)
  // Bumped when the open chat changes, so a load the reader has already left cannot clear
  // the chat they moved to. Strict mode runs the restore effect twice; the first load is
  // dropped the same way.
  const generation = useRef(0)
  const [chatId, setChatId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  // True while a saved chat is being read, so the empty welcome does not flash first.
  const [opening, setOpening] = useState(() => loadAskChat(userId) !== null)
  const [openFailed, setOpenFailed] = useState(false)
  // Kept here, not in the panel, so a half-typed question survives the panel remounting
  // (Graph's Details | Ask tabs).
  const [draft, setDraft] = useState('')
  // The open chat and the answer in flight, as refs: a callback from an answer or a load the
  // reader has already left compares against them and does nothing.
  const chat = useRef<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const answering = turns.at(-1)?.status === 'answering'

  useEffect(() => () => controller.current?.abort(), [])

  function remember(id: string | null) {
    /* v8 ignore next -- ask() runs from an event, after the mount effect has set hydrated */
    if (!hydrated.current) return
    saveAskChat(userId, id)
  }

  const updateTurn = (id: number, change: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)))

  /** Ends the answer in flight and starts the next one's controller. `isCurrent` turns false once
   * the reader moves on, so a late reply can tell it is no longer wanted. */
  function startAnswer() {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    return { abort, isCurrent: () => controller.current === abort }
  }

  /** Asks `question`. `retry` replaces the failed turn at the end instead of adding another. */
  async function ask(question: string, context: AskContext, retry = false) {
    const { abort, isCurrent } = startAnswer()
    const turn: Turn = { id: nextTurnId++, question, statements: [], status: 'answering' }
    setTurns((all) => [...(retry ? all.slice(0, -1) : all), turn])
    try {
      // The chat is made on the first question, so opening the panel leaves no empty chat behind.
      let id = chat.current
      if (!id) {
        const created = await request<ChatSummary>('/assistant/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context }),
          signal: abort.signal,
        })
        if (!isCurrent()) return
        id = created.id
        chat.current = id
        setChatId(id)
        remember(id)
      }
      await postEvents<AnswerEvent>(
        `/assistant/chats/${encodeURIComponent(id)}/messages`,
        { question, context },
        (event) => isCurrent() && updateTurn(turn.id, (shown) => applyEvent(shown, event)),
        abort.signal,
      )
      // A stream that ends without "done" broke off.
      if (isCurrent()) updateTurn(turn.id, (shown) => (shown.status === 'answering' ? { ...shown, status: 'failed' } : shown))
    } catch {
      if (isCurrent()) updateTurn(turn.id, (shown) => ({ ...shown, status: 'failed' }))
    }
  }

  /** Runs a /command: its tool's result becomes this turn's statements or note. Not saved in the chat. */
  async function run(question: string, command: Extract<Parsed, { name: string }>) {
    const { abort, isCurrent } = startAnswer()
    const turn: Turn = { id: nextTurnId++, question, statements: [], status: 'answering', command: `/${command.name}` }
    setTurns((all) => [...all, turn])
    try {
      const result = await request<Record<string, unknown>>(`/agent/tools/${command.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.args),
        signal: abort.signal,
      })
      if (isCurrent()) updateTurn(turn.id, (shown) => ({ ...shown, ...describeResult(command.name, result, command.args), status: 'done' }))
    } catch (error) {
      if (!isCurrent() || (error as Error).name === 'AbortError') return
      // The reason, not "the answer failed": a command has no answer to ask again.
      const reason = error instanceof Error ? error.message : 'unknown error'
      updateTurn(turn.id, (shown) => ({ ...shown, view: { kind: 'message', text: `/${command.name} could not run: ${reason}` }, status: 'done' }))
    }
  }

  /** Shows a /command that cannot run, such as an unknown name, as a finished turn. */
  function refuse(question: string, note: string) {
    setTurns((all) => [...all, { id: nextTurnId++, question, statements: [], status: 'done', view: { kind: 'message', text: note }, command: question.split(' ')[0] }])
  }

  /** Stops the answer and keeps what arrived. */
  const stop = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setTurns((all) => all.map((turn) => (turn.status === 'answering' ? { ...turn, status: 'stopped' } : turn)))
  }, [])

  const showChat = useCallback(
    (id: string | null) => {
      generation.current += 1
      stop()
      chat.current = id
      setChatId(id)
      setTurns([])
      setOpening(false)
      setOpenFailed(false)
      /* v8 ignore next -- every caller runs after the mount effect has set hydrated */
      if (hydrated.current) saveAskChat(userId, id)
    },
    [stop, userId],
  )

  function newChat() {
    showChat(null)
  }

  const openChat = useCallback(
    async (id: string) => {
      showChat(id)
      const mine = generation.current
      setOpening(true)
      try {
        const loaded = await loadChat(id)
        if (generation.current !== mine || chat.current !== id) return
        setTurns(loaded)
      } catch (error) {
        if (generation.current !== mine || chat.current !== id) return
        // A chat the server no longer has is forgotten, and a new chat shows. Any other failure
        // (the gateway asleep, the network) keeps the id, so the next refresh tries it again.
        if ((error as Error).message.startsWith('404')) showChat(null)
        else setOpenFailed(true)
      } finally {
        if (generation.current === mine && chat.current === id) setOpening(false)
      }
    },
    [showChat],
  )

  // Reopen the chat this user had, including after a refresh. A different signed-in user
  // reads their own id, so they do not land in the previous account's chat. An account with
  // nothing stored only clears the screen when another account's chat is still showing.
  useEffect(() => {
    hydrated.current = true
    const stored = loadAskChat(userId)
    if (stored) void openChat(stored)
    else if (chat.current !== null) showChat(null)
    return () => {
      generation.current += 1
    }
  }, [openChat, showChat, userId])

  return { chatId, turns, answering, opening, openFailed, draft, setDraft, ask, run, refuse, stop, newChat, openChat }
}

export type Assistant = ReturnType<typeof useAssistant>
