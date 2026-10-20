/**
 * A coding agent in this tab, for a role's app: the bridge to the gateway (lib/agentBridge), the
 * toolbar pill that shows it working, the connect screen (opened by ?connect=agent) and the AI
 * cursor it moves. Ask uses it for the researcher; the labeler uses it without Ask.
 */

import { MotionConfig } from 'framer-motion'
import { useState } from 'react'

import { useAgentBridge } from '../lib/agentBridge'
import type { ScreenActions } from '../lib/agentTools'
import { useAuth } from '../lib/useAuth'
import { AiCursor } from './AiCursor'
import { AgentStatus, ConnectAgent } from './ConnectAgent'

export function useAgentConnection(actions?: ScreenActions) {
  const bridge = useAgentBridge(actions)
  const { session } = useAuth()
  // ?connect=agent opens the connect screen, so docs and the agent's error can link to it.
  const [connecting, setConnecting] = useState(
    () => new URLSearchParams(window.location.search).get('connect') === 'agent',
  )

  /** Closes the connect screen and drops ?connect=, so a reload does not open it again. */
  function closeConnect() {
    setConnecting(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('connect')
    window.history.replaceState(window.history.state, '', url)
  }

  /** The pill for the toolbar, while an agent is connected. */
  const pill = bridge.connected ? <AgentStatus bridge={bridge} /> : null

  /** The connect screen and the cursor; place it anywhere inside the shell. */
  const overlay = (
    <>
      {connecting && bridge.canConnect && !bridge.connected && (
        <ConnectAgent
          email={session?.user?.email ?? null}
          onAllow={() => {
            bridge.connect(true)
            closeConnect()
          }}
          onCancel={closeConnect}
        />
      )}
      {bridge.connected && (
        <MotionConfig reducedMotion="user">
          <AiCursor pointing={bridge.pointing} />
        </MotionConfig>
      )}
    </>
  )

  return { bridge, pill, overlay, openConnect: () => setConnecting(true) }
}
