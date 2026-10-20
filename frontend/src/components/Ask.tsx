/**
 * Ask for any role: the toolbar button, the assistant panel, and the page viewer its sources
 * open in. A role app calls useAsk with what is on its screen and places the three pieces:
 * `button` in AppShell's toolbarLead, `panel` in AppShell's panel (or a screen's own side panel,
 * as Graph does), and `viewer` anywhere inside the shell. A role with screen actions also gets
 * a coding agent over MCP (components/ConnectAgent): its pill goes with `button`, its connect screen and cursor
 * with `viewer`.
 */

import { MotionConfig } from 'framer-motion'
import { useState } from 'react'

import { api, paperName } from '../lib/api'
import type { AskContext } from '../lib/assistant'
import { shortTitle, useAssistant } from '../lib/assistant'
import { useAgentBridge } from '../lib/agentBridge'
import { useAnalyses } from '../lib/useAnalysis'
import { useAuth } from '../lib/useAuth'
import type { ScreenActions } from '../lib/agentTools'
import { AiCursor } from './AiCursor'
import { AskButton } from './AskButton'
import type { AskAbout } from './AssistantPanel'
import { AssistantPanel } from './AssistantPanel'
import { AgentStatus, ConnectAgent } from './ConnectAgent'
import { DoIt } from './DoIt'
import { PageViewer, type Target } from './PageViewer'

/** A graph node the reader selected, which a question can be about. */
export type AskNode = { id: string; label: string }

export function useAsk({
  screen,
  analysis = null,
  analysisFile = null,
  node = null,
  canNarrow = true,
  actions,
}: {
  screen: string
  /** The open analysis's id, when the screen shows one. */
  analysis?: string | null
  /** Its PDF's file name, the chip's fallback when the analysis has no title. */
  analysisFile?: string | null
  node?: AskNode | null
  /** False for a role with no paper or graph node to open (Teacher). */
  canNarrow?: boolean
  /** What the screen agent may do in this role; with it, Ask gets the Do it mode. */
  actions?: ScreenActions
}) {
  const assistant = useAssistant()
  const [open, setOpen] = useState(false)
  // The paper or node whose chip the reader removed: questions about it go to the whole
  // library. Opening a different paper or node brings the chip back.
  const [cleared, setCleared] = useState<string | null>(null)
  const [source, setSource] = useState<Target | null>(null)
  const { data: analyses = [] } = useAnalyses()
  const { session } = useAuth()
  const bridge = useAgentBridge(actions)
  // ?connect=agent opens the connect screen, so docs and the agent's error can link to it.
  const [connecting, setConnecting] = useState(
    () => new URLSearchParams(window.location.search).get('connect') === 'agent',
  )
  const titles = Object.fromEntries(
    analyses.flatMap((a) => (a.file && a.title ? [[paperName(a.file), shortTitle(a.title)]] : [])),
  )

  const asked = analysis && analysis !== cleared ? analysis : null
  const askedNode = !asked && node && node.id !== cleared ? node : null
  const context: AskContext = { screen, analysis: asked ?? undefined, node: askedNode?.id }
  const about: AskAbout = asked
    ? { kind: 'paper', label: titles[paperName(analysisFile ?? '')] || analysisFile || 'this paper' }
    : askedNode
      ? { kind: 'node', label: askedNode.label }
      : { kind: 'library', label: 'your library' }

  /** Opens a statement's page with its quote marked, when the quote can be found on it. */
  async function showSource(target: Target) {
    const found = target.quote ? await api.findInPaper(target.paper, target.quote, target.page).catch(() => null) : null
    setSource({ ...target, source: found?.page ? (found as Target['source']) : null })
  }

  /** Closes the connect screen and drops ?connect=, so a reload does not open it again. */
  function closeConnect() {
    setConnecting(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('connect')
    window.history.replaceState(window.history.state, '', url)
  }

  const button = (
    <div className="flex items-center gap-2">
      {bridge.connected && <AgentStatus bridge={bridge} />}
      <AskButton open={open} about={about} onToggle={() => setOpen(!open)} />
    </div>
  )

  const panel = open ? (
    <AssistantPanel
      assistant={assistant}
      context={context}
      about={about}
      titles={titles}
      canNarrow={canNarrow}
      onClearAbout={() => setCleared(asked ?? askedNode?.id ?? null)}
      onClose={() => setOpen(false)}
      onShowSource={(target) => void showSource(target)}
      doIt={actions && <DoIt actions={actions} onConnectAgent={bridge.connected ? undefined : () => setConnecting(true)} />}
    />
  ) : undefined

  const viewer = (
    <>
      {source && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-4" role="dialog" aria-modal="true" aria-label={source.label}>
          <PageViewer target={source} onClose={() => setSource(null)} className="h-[90vh] w-full max-w-4xl" />
        </div>
      )}
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

  return { button, panel, viewer }
}
