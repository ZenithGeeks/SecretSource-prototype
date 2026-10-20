/**
 * Claude Code in this tab. Once the person allows it on the connect screen
 * (components/ClaudeCode), the tab holds the gateway's bridge stream open
 * (backend/app/screen_bridge.py) and runs each screen tool call that Claude Code sends over MCP,
 * with the AI cursor and the Apply card (lib/agentTools). It stays connected across reloads of
 * this tab until the person disconnects.
 */

import { useEffect, useRef, useState } from 'react'

import { followEvents, request } from './api'
import type { Pointing } from './askCursor'
import { describeTool, runTool, type ScreenActions, type ToolCall } from './agentTools'
import type { PendingChange } from './screenAgent'

const CONNECTED_KEY = 'claudeCode.connected'
const STEPS_SHOWN = 4
const CURSOR_REST_MS = 2500 // as long as Ask's cursor rests on its last check

/** The events backend/app/screen_bridge.py streams to the tab. */
type BridgeEvent = { type: 'ready' } | ({ type: 'tool' } & ToolCall)

export type ClaudeCode = ReturnType<typeof useClaudeCode>

export function useClaudeCode(actions: ScreenActions | undefined) {
  const [connected, setConnected] = useState(readConnected)
  const [steps, setSteps] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [pointing, setPointing] = useState<Pointing | null>(null)
  // The latest actions: after open_screen the app is on another screen, and read_screen says so.
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })
  const canConnect = actions !== undefined

  useEffect(() => {
    if (!connected || !canConnect) return
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
    let rest: number | undefined
    const close = followEvents<BridgeEvent>('/agent/bridge', async (event) => {
      if (event.type !== 'tool' || !latest.current) return
      window.clearTimeout(rest)
      setSteps((all) => [...all, describeTool(event)].slice(-STEPS_SHOWN))
      setWorking(true)
      const result = await runTool(event, { actions: latest.current, point: setPointing, confirm })
      setWorking(false)
      // The cursor rests where it went, then leaves, unless the next call moves it first.
      rest = window.setTimeout(() => setPointing(null), CURSOR_REST_MS)
      await request('/agent/bridge/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.id, result }),
      })
    })
    return () => {
      close()
      window.clearTimeout(rest)
    }
  }, [connected, canConnect])

  function connect(on: boolean) {
    setConnected(on)
    writeConnected(on)
    if (on) return
    pending?.answer(false)
    setPointing(null)
    setSteps([])
  }

  return { canConnect, connected, connect, steps, working, pending, pointing }
}

function readConnected(): boolean {
  try {
    return window.sessionStorage.getItem(CONNECTED_KEY) === '1'
  } catch {
    return false
  }
}

function writeConnected(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(CONNECTED_KEY, '1')
    else window.sessionStorage.removeItem(CONNECTED_KEY)
  } catch {
    // Storage can be refused; the tab then forgets the connection on reload, which is safe.
  }
}
