/**
 * Ask for any role: the toolbar button, the assistant panel, and the page viewer its sources
 * open in. A role app calls useAsk with what is on its screen and places the three pieces:
 * `button` in AppShell's toolbarLead, `panel` in AppShell's panel (or a screen's own side panel,
 * as Graph does), and `viewer` anywhere inside the shell. A role with screen actions also gets
 * a coding agent over MCP (components/ConnectAgent): its pill goes with `button`, its connect screen and cursor
 * with `viewer`.
 */

import { useState, type ComponentProps } from 'react'

import { api, paperName } from '../lib/api'
import type { Role } from '../lib/roles'
import type { AskContext } from '../lib/assistant'
import { shortTitle, useAssistant } from '../lib/assistant'
import { loadAskOpen, saveAskMode, saveAskOpen, useAskUserId } from '../lib/askSession'
import type { PaperRef } from '../lib/askCommands'
import { useAnalyses } from '../lib/useAnalysis'
import type { ScreenActions } from '../lib/agentTools'
import { peekDoItConversation } from '../lib/doItConversation'
import { AskButton } from './AskButton'
import type { AskAbout } from './AssistantPanel'
import { AssistantPanel } from './AssistantPanel'

type AssistantPanelProps = ComponentProps<typeof AssistantPanel>
import { DoIt } from './DoIt'
import { PageViewer, type Target } from './PageViewer'
import { useAgentConnection } from './useAgentConnection'

/** A graph node the reader selected, which a question can be about. */
export type AskNode = { id: string; label: string }

export function useAsk({
  role,
  screen,
  analysis = null,
  analysisFile = null,
  node = null,
  canNarrow = true,
  actions,
  extra,
}: {
  /** Whose Quip (components/Mascot) the button and panel show. */
  role: Role
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
  /** A mode for what the screen shows (AssistantPanel's `extra`). */
  extra?: AssistantPanelProps['extra']
}) {
  const assistant = useAssistant()
  const userId = useAskUserId()
  // Open or closed as it was for this user, including after a refresh, and always open when a
  // role switch carried a Do it conversation here. Another account on this browser has its own
  // value; applying it here does not write.
  const [open, setOpen] = useState(() => peekDoItConversation() !== null || loadAskOpen(userId))
  const [openFor, setOpenFor] = useState(userId)
  if (openFor !== userId) {
    setOpenFor(userId)
    setOpen(loadAskOpen(userId))
  }
  function setOpenSaved(next: boolean) {
    setOpen(next)
    saveAskOpen(userId, next)
  }
  // The panel reads its mode when it mounts, so showExtra remounts it on the screen's own mode.
  const [panelKey, setPanelKey] = useState(0)
  /** Opens the panel on the screen's own mode (`extra`), as when a screen hands it something to ask about. */
  function showExtra() {
    saveAskMode(userId, 'extra')
    setPanelKey((key) => key + 1)
    setOpenSaved(true)
  }
  // The paper or node whose chip the reader removed: questions about it go to the whole
  // library. Opening a different paper or node brings the chip back.
  const [cleared, setCleared] = useState<string | null>(null)
  const [source, setSource] = useState<Target | null>(null)
  const { data: analyses = [] } = useAnalyses()
  const agent = useAgentConnection(actions)
  const titles = Object.fromEntries(
    analyses.flatMap((a) => (a.file && a.title ? [[paperName(a.file), shortTitle(a.title)]] : [])),
  )

  const papers: PaperRef[] = analyses.flatMap((a) => (a.title ? [{ id: a.id, label: shortTitle(a.title) }] : []))

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

  const button = (
    <div className="flex items-center gap-2">
      {agent.pill}
      <AskButton role={role} open={open} about={about} onToggle={() => setOpenSaved(!open)} />
    </div>
  )

  const panel = open ? (
    <AssistantPanel
      key={panelKey}
      role={role}
      assistant={assistant}
      context={context}
      about={about}
      titles={titles}
      papers={papers}
      canNarrow={canNarrow}
      onClearAbout={() => setCleared(asked ?? askedNode?.id ?? null)}
      onClose={() => setOpenSaved(false)}
      onShowSource={(target) => void showSource(target)}
      doIt={actions && <DoIt actions={actions} onConnectAgent={agent.bridge.connected ? undefined : agent.openConnect} />}
      initialMode={peekDoItConversation() ? 'do' : undefined}
      extra={extra}
    />
  ) : undefined

  const viewer = (
    <>
      {source && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-4" role="dialog" aria-modal="true" aria-label={source.label}>
          <PageViewer target={source} onClose={() => setSource(null)} className="h-[90vh] w-full max-w-4xl" />
        </div>
      )}
      {agent.overlay}
    </>
  )

  return { button, panel, viewer, showExtra }
}
