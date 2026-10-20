/**
 * The screen agent's conversation (Ask's Do it mode): sends the person's message, runs each tool
 * call the agent sends with lib/agentTools, and sends the result back until the agent is done.
 * Routes: backend/app/agent_runs.py. One message runs at a time; Stop ends it after the call in
 * progress.
 */

import { useEffect, useRef, useState } from 'react'

import { postEvents } from './api'
import type { Pointing } from './askCursor'
import { describeTool, runTool, type ScreenActions, type ToolCall } from './agentTools'

export type AgentLine =
  | { kind: 'person'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'step'; text: string }
  | { kind: 'error'; text: string }

/** A change the agent wants to make, waiting for the person. */
export type PendingChange = { label: string; text: string; answer: (apply: boolean) => void }

/** The events agent_runs.py streams; its module docstring describes each one. */
type AgentEvent =
  | { type: 'session'; id: string }
  | ({ type: 'tool' } & ToolCall)
  | { type: 'step'; name: string }
  | { type: 'say'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

const SERVER_STEPS: Record<string, string> = { list_papers: 'Looking through your papers' }

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
  const add = (line: AgentLine) => setLines((all) => [...all, line])

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
    const confirm = ({ label, text }: { label: string; text: string }) =>
      new Promise<boolean>((resolve) =>
        setPending({
          label,
          text,
          answer: (apply) => {
            setPending(null)
            resolve(apply)
          },
        }),
      )
    try {
      // Each message starts a new agent session, so the agent never acts on a screen it saw messages ago.
      let call = await stream('/agent/runs', { message, screen: latest.current.screen }, abort.signal)
      while (call && !abort.signal.aborted) {
        add({ kind: 'step', text: describeTool(call) })
        const result = await runTool(call, { actions: latest.current, point, confirm })
        const body = { id: call.id, name: call.name, result }
        call = await stream(`/agent/runs/${encodeURIComponent(session.current ?? '')}/results`, body, abort.signal)
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') add({ kind: 'error', text: 'The agent could not be reached. Try again.' })
    } finally {
      setRunning(false)
      setPending(null)
    }
  }

  function stop() {
    controller.current?.abort()
    pending?.answer(false)
  }

  return { lines, running, pending, send, stop }
}
