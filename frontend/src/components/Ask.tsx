/**
 * Ask for any role: the toolbar button, the assistant panel, and the page viewer its sources
 * open in. A role app calls useAsk with what is on its screen and places the three pieces:
 * `button` in AppShell's toolbarLead, `panel` in AppShell's panel (or a screen's own side panel,
 * as Graph does), and `viewer` anywhere inside the shell. A role with screen actions also gets
 * a coding agent over MCP (components/ConnectAgent): its pill goes with `button`, its connect screen and cursor
 * with `viewer`.
 */

import { useCallback, useRef, useState, type ComponentProps } from 'react'

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

import { DoIt } from './DoIt'
import { PageViewer, type Target } from './PageViewer'
import { SourceDialog } from './SourceDialog'
import { useAgentConnection } from './useAgentConnection'

type AssistantPanelProps = ComponentProps<typeof AssistantPanel>

/** A graph node the reader selected, which a question can be about. */
export type AskNode = { id: string; label: string }

export function useAsk({
  role,
  screen,
  analysis = null,
  analysisFile = null,
  node = null,
  canNarrow = true,
  scope,
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
  /** The button's words after "Ask AI", when the screen is about something other than `about`; empty for none (AskButton). */
  scope?: string
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
  // A request a screen typed into Do it for the person to send (askToDo), held until Do it has it
  // in its field; `n` tells a repeat apart. It only ever goes up: the request is dropped once Do it
  // has it, and a count restarting at 1 would read as the one Do it already took.
  const [doRequest, setDoRequest] = useState<{ text: string; n: number } | null>(null)
  const requests = useRef(0)
  const clearDoRequest = useCallback(() => setDoRequest(null), [])
  /** Opens Ask on Do it with `text` in its field, not sent: the person reads it and presses Do it.
   * The panel is not remounted, so a Do it conversation already on screen stays. */
  function askToDo(text: string) {
    saveAskMode(userId, 'do')
    requests.current += 1
    setDoRequest({ text, n: requests.current })
    setOpenSaved(true)
  }
  // The paper or node whose chip the reader removed: questions about it go to the whole
  // library. Opening a different paper or node brings the chip back.
  const [cleared, setCleared] = useState<string>()
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
    const found = target.quote ? await findQuote(target.paper, target.quote, target.page) : null
    setSource({ ...target, page: found?.page ?? target.page, source: found?.page ? (found as Target['source']) : null })
  }

  /** Where the judge's quote sits. The judge joins pieces of passages with "…", which no page holds
   * word for word, so the longest piece is looked for: on its page first, then in the whole paper. */
  async function findQuote(paper: string, quote: string, page?: number) {
    const piece = quote.split('…').reduce((longest, part) => (part.trim().length > longest.length ? part.trim() : longest), '')
    const onPage = await api.findInPaper(paper, piece, page).catch(() => null)
    if (onPage?.page || !page) return onPage
    return api.findInPaper(paper, piece).catch(() => null)
  }

  const button = (
    <div className="flex items-center gap-2">
      {agent.pill}
      <AskButton role={role} open={open} about={about} scope={scope} onToggle={() => setOpenSaved(!open)} />
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
      onClearAbout={() => setCleared(asked ?? askedNode?.id)}
      onClose={() => setOpenSaved(false)}
      onShowSource={(target) => void showSource(target)}
      doIt={actions && <DoIt actions={actions} onConnectAgent={agent.bridge.connected ? undefined : agent.openConnect} prefill={doRequest ?? undefined} onPrefilled={clearDoRequest} />}
      initialMode={peekDoItConversation() ? 'do' : undefined}
      doRequest={doRequest?.n}
      extra={extra}
    />
  ) : undefined

  const viewer = (
    <>
      {source && (
        <SourceDialog label={source.label}>
          <PageViewer target={source} onClose={() => setSource(null)} className="h-[90vh] w-full max-w-4xl" />
        </SourceDialog>
      )}
      {agent.overlay}
    </>
  )

  return { button, panel, viewer, showExtra, askToDo }
}
