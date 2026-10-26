/**
 * The screen agent's conversation (Ask's Do it mode): sends the person's message, runs each tool
 * call the agent sends with lib/agentTools, and sends the result back until the agent is done.
 * Routes: backend/app/agent_runs.py. One message runs at a time; Stop ends it after the call in
 * progress.
 */

import { useEffect, useRef, useState } from 'react'

import { describeTool, runTool, type ConfirmRequest, type ScreenActions, type ToolCall } from './agentTools'
import { postEvents } from './api'
import type { Pointing } from './askCursor'
import { clearDoItConversation, leaveDoItConversation, peekDoItConversation } from './doItConversation'
import type { Role } from './roles'

export type AgentLine =
  | { kind: 'person'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'step'; text: string }
  | { kind: 'delegation'; name: string; task: string; state: DelegationState }
  | { kind: 'error'; text: string }

/** A specialist the agent handed work to: working until it answers, stopped if the person pressed Stop. */
export type DelegationState = 'working' | 'done' | 'failed' | 'stopped'

/** A change the agent wants to make, waiting for the person. One card for every change. */
export type PendingChange = ConfirmRequest & { answer: (apply: boolean) => void }

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
  labeling_papers: 'Looking through the papers to label',
  claim_passages: 'Reading the passages for a claim',
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
  // Peek, don't take: strict mode mounts twice, and closing Ask remounts this view.
  const restored = useState(() => peekDoItConversation())[0]
  const [lines, setLines] = useState<AgentLine[]>(() => (restored?.lines as AgentLine[] | undefined) ?? [])
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const linesRef = useRef(lines)
  const session = useRef<string | null>(restored?.sessionId ?? null)
  // A restored conversation keeps its session, so the new role's agent reads what was said.
  const continued = useRef(restored !== null)
  const controller = useRef<AbortController | null>(null)
  const pendingRef = useRef<PendingChange | null>(null)
  // Set while this view is gone, so a run still finishing does not carry its transcript into
  // the next role or the next account after the role menu or sign-out cleared it.
  const unmounted = useRef(false)
  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      controller.current?.abort()
      pendingRef.current?.answer(false)
    }
  }, [])
  // The latest actions: after open_screen the app is on another screen, and read_screen says so.
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })

  /** Replaces the transcript. A continued conversation is what the next role's Do it restores. */
  const commit = (next: AgentLine[]) => {
    linesRef.current = next
    setLines(next)
    if (continued.current && !unmounted.current) leaveDoItConversation({ lines: next, sessionId: session.current })
  }
  const add = (line: AgentLine) => commit([...linesRef.current, line])

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
          if (continued.current && !unmounted.current) leaveDoItConversation({ lines: linesRef.current, sessionId: session.current })
          break
        case 'tool':
          call = { id: event.id, name: event.name, args: event.args }
          break
        case 'step':
          add({ kind: 'step', text: SERVER_STEPS[event.name] ?? event.name })
          break
        case 'agent':
          if (event.state === 'working') add({ kind: 'delegation', name: event.name, task: event.task ?? '', state: 'working' })
          else commit(settle(linesRef.current, event.name, event.state))
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
    const confirm = (change: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        // Stopped or closed before the card could show: the unmount cleanup has already run and
        // would never answer it, so answer Cancel here.
        if (abort.signal.aborted) return resolve(false)
        const card: PendingChange = {
          ...change,
          answer: (apply) => {
            pendingRef.current = null
            setPending(null)
            resolve(apply)
          },
        }
        pendingRef.current = card
        setPending(card)
      })
    // Set when switch_role is approved. The move happens after the agent has had its sentence,
    // so the result is sent to the role that asked and the transcript survives the unmount.
    let switchedTo: Role | null = null
    try {
      // A new message starts a new session, except one carried across a role switch: that role's
      // agent reads the whole conversation (backend/app/agent_runs.py).
      const { role, screen } = latest.current
      const sessionId = continued.current ? session.current : null
      const payload: Record<string, unknown> = { message, screen }
      if (role) payload.role = role
      if (sessionId) payload.session_id = sessionId
      let call: ToolCall | null
      try {
        call = await stream('/agent/runs', payload, abort.signal)
      } catch (error) {
        if (!sessionId || (error as Error).name === 'AbortError') throw error
        // The carried session ended (an hour after it started, or a gateway restart). Start a new
        // one rather than failing every message until the role menu is used.
        session.current = null
        continued.current = false
        clearDoItConversation()
        add({ kind: 'step', text: 'The earlier conversation had ended, so this starts a new one' })
        const { session_id: _ended, ...fresh } = payload
        call = await stream('/agent/runs', fresh, abort.signal)
      }
      while (call && !abort.signal.aborted) {
        add({ kind: 'step', text: describeTool(call) })
        const result = await runTool(call, {
          actions: latest.current,
          point,
          confirm,
          onSwitched: (next) => {
            switchedTo = next
          },
        })
        // Stopped or closed while the tool ran: send nothing more.
        if (abort.signal.aborted) break
        if (call.name === 'switch_role' && result.status !== 'switched') switchedTo = null
        // The role whose agent made the call, so its result goes back to that agent.
        const body: Record<string, unknown> = { id: call.id, name: call.name, result }
        if (role) body.role = role
        call = await stream(`/agent/runs/${encodeURIComponent(session.current ?? '')}/results`, body, abort.signal)
      }
      if (switchedTo && !abort.signal.aborted && latest.current.switchRole) {
        const settled = settle(linesRef.current, null, 'stopped')
        linesRef.current = settled
        setLines(settled)
        leaveDoItConversation({ lines: settled, sessionId: session.current })
        latest.current.switchRole(switchedTo)
        switchedTo = null
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') add({ kind: 'error', text: 'The agent could not be reached. Try again.' })
    } finally {
      setRunning(false)
      setPending(null)
      // A hand-over still open when the run ends was cut off by Stop or a lost connection.
      commit(settle(linesRef.current, null, 'stopped'))
    }
  }

  function stop() {
    controller.current?.abort()
    pending?.answer(false)
  }

  return { lines, running, pending, send, stop }
}
