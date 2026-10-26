/**
 * The screen agent's conversation (Ask's Do it mode): sends the person's message, runs each tool
 * call the agent sends with lib/agentTools, and sends the result back until the agent is done.
 * Routes: backend/app/agent_runs.py. One message runs at a time; Stop ends it after the call in
 * progress.
 */

import { useEffect, useRef, useState } from 'react'

import { postEvents } from './api'
import type { Pointing } from './askCursor'
import { describeTool, runTool, type Change, type ScreenActions, type ToolCall } from './agentTools'

export type AgentLine =
  | { kind: 'person'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'step'; text: string }
  | { kind: 'delegation'; name: string; task: string; state: DelegationState }
  | { kind: 'error'; text: string }

/** A specialist the agent handed work to: working until it answers, stopped if the person pressed Stop. */
export type DelegationState = 'working' | 'done' | 'failed' | 'stopped'

/** A change the agent wants to make, waiting for the person; a field's text unless `kind` says otherwise. */
export type PendingChange = { kind?: Change['kind']; label: string; text: string; answer: (apply: boolean) => void }

/** The events agent_runs.py streams; its module docstring describes each one. */
type AgentEvent =
  | { type: 'session'; id: string }
  | ({ type: 'tool' } & ToolCall)
  | { type: 'step'; name: string }
  | { type: 'agent'; name: string; state: 'working' | 'done' | 'failed'; task?: string }
  | { type: 'say'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

const SERVER_STEPS: Record<string, string> = {
  list_papers: 'Looking through your papers',
  get_analysis: 'Reading an analysis',
  get_claim: 'Reading the evidence for a claim',
  search_claims: 'Searching your claims',
  find_in_paper: 'Finding text in a paper',
  find_support: 'Searching your papers for support',
  check_text: 'Checking the text against your papers',
  ask_library: 'Asking your library',
  get_gaps: 'Looking for gaps in your library',
  bibtex: 'Writing BibTeX',
  submit_analysis: 'Starting an analysis',
  labeling_progress: 'Reading your labeling progress',
  list_drafts: 'Looking through your drafts',
  draft_issues: 'Reading what needs work in a draft',
}

/** The open hand-overs (to `name`, or any) set to `state`. */
function settle(lines: AgentLine[], name: string | null, state: DelegationState): AgentLine[] {
  return lines.map((line) =>
    line.kind === 'delegation' && line.state === 'working' && (name === null || line.name === name) ? { ...line, state } : line,
  )
}

export function useScreenAgent(actions: ScreenActions, point: (pointing: Pointing | null) => void) {
  const [lines, setLines] = useState<AgentLine[]>([])
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const session = useRef<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  // The latest actions: after open_screen the app is on another screen, and read_screen says so.
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })
  // Leaving the screen (a role switch closes the whole role app) stops the run: no more tool
  // calls, no more posts, and a change waiting for Apply is cancelled.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])
  const add = (line: AgentLine) => {
    if (alive.current) setLines((all) => [...all, line])
  }

  /**
   * The events of one stream; returns the tool call it ended on, if any. The "session" event
   * keeps the id that the results route needs.
   */
  async function stream(path: string, body: unknown, signal: AbortSignal): Promise<ToolCall | null> {
    let call: ToolCall | null = null // set by the "tool" event, the last one before the stream ends
    const onEvent = (event: AgentEvent) => {
      switch (event.type) {
        case 'session':
          session.current = event.id
          break
        case 'tool':
          call = { id: event.id, name: event.name, args: event.args }
          break
        case 'step':
          add({ kind: 'step', text: SERVER_STEPS[event.name] ?? event.name })
          break
        case 'agent':
          if (event.state === 'working') add({ kind: 'delegation', name: event.name, task: event.task ?? '', state: 'working' })
          else if (alive.current) setLines((all) => settle(all, event.name, event.state))
          break
        case 'say':
          add({ kind: 'agent', text: event.text })
          break
        case 'error':
          add({ kind: 'error', text: `Stopped: ${event.message}` })
          break
      }
    }
    await postEvents<AgentEvent>(path, body, onEvent, signal)
    return call
  }

  async function send(message: string) {
    controller.current?.abort()
    const abort = (controller.current = new AbortController())
    add({ kind: 'person', text: message })
    setRunning(true)
    // A change waits for the person until they answer, or until Stop or leaving the screen
    // aborts the run, which answers Cancel.
    const confirm = ({ kind, label, text }: Change) =>
      new Promise<boolean>((resolve) => {
        if (abort.signal.aborted) return resolve(false)
        const answer = (apply: boolean) => {
          abort.signal.removeEventListener('abort', cancel)
          if (alive.current) setPending(null)
          resolve(apply)
        }
        const cancel = () => answer(false)
        abort.signal.addEventListener('abort', cancel, { once: true })
        setPending({ kind, label, text, answer })
      })
    try {
      // Each message starts a new agent session, so the agent never acts on a screen it saw messages ago.
      const { role, screen } = latest.current
      let call = await stream('/agent/runs', { message, screen, role }, abort.signal)
      while (call && !abort.signal.aborted) {
        add({ kind: 'step', text: describeTool(call) })
        const result = await runTool(call, { actions: latest.current, point, confirm })
        // After a switch this role's agent is done: the person's next message goes to the new
        // role's agent in a new session, so the result is not sent back for another turn here.
        if (abort.signal.aborted || result.status === 'switched') break
        // The role whose agent made the call, so its result goes back to that agent.
        const body = { id: call.id, name: call.name, result, role }
        call = await stream(`/agent/runs/${encodeURIComponent(session.current ?? '')}/results`, body, abort.signal)
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') add({ kind: 'error', text: 'The agent could not be reached. Try again.' })
    } finally {
      if (alive.current) {
        setRunning(false)
        setPending(null)
        // A hand-over still open when the run ends was cut off by Stop or a lost connection.
        setLines((all) => settle(all, null, 'stopped'))
      }
    }
  }

  function stop() {
    controller.current?.abort() // also answers Cancel to a change waiting for the person
  }

  return { lines, running, pending, send, stop }
}
