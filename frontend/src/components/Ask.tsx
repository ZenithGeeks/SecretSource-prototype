/**
 * Ask for any role: the toolbar button, the assistant panel, and the page viewer its sources
 * open in. A role app calls useAsk with what is on its screen and places the three pieces:
 * `button` in AppShell's toolbarLead, `panel` in AppShell's panel (or a screen's own side panel,
 * as Graph does), and `viewer` anywhere inside the shell.
 */

import { Sparkles } from 'lucide-react'
import { useState } from 'react'

import { api, paperName } from '../lib/api'
import type { AskContext } from '../lib/assistant'
import { shortTitle, useAssistant } from '../lib/assistant'
import { useAnalyses } from '../lib/useAnalysis'
import { cn } from '../lib/utils'
import type { AskAbout } from './AssistantPanel'
import { AssistantPanel } from './AssistantPanel'
import { PageViewer, type Target } from './PageViewer'

/** A graph node the reader selected, which a question can be about. */
export type AskNode = { id: string; label: string }

export function useAsk({
  screen,
  analysis = null,
  analysisFile = null,
  node = null,
  canNarrow = true,
}: {
  screen: string
  /** The open analysis's id, when the screen shows one. */
  analysis?: string | null
  /** Its PDF's file name, the chip's fallback when the analysis has no title. */
  analysisFile?: string | null
  node?: AskNode | null
  /** False for a role with no paper or graph node to open (Teacher). */
  canNarrow?: boolean
}) {
  const assistant = useAssistant()
  const [open, setOpen] = useState(false)
  // The paper or node whose chip the reader removed: questions about it go to the whole
  // library. Opening a different paper or node brings the chip back.
  const [cleared, setCleared] = useState<string | null>(null)
  const [source, setSource] = useState<Target | null>(null)
  const { data: analyses = [] } = useAnalyses()
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

  const button = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium lg:min-h-8',
        open ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-ink hover:bg-accent-soft',
      )}
    >
      <Sparkles className="size-4" aria-hidden="true" />
      {/* Icon only on a phone, where the toolbar also holds the breadcrumb and the screen's own actions. */}
      <span className="sr-only sm:not-sr-only">Ask</span>
    </button>
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
    />
  ) : undefined

  const viewer = source && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-4" role="dialog" aria-modal="true" aria-label={source.label}>
      <PageViewer target={source} onClose={() => setSource(null)} className="h-[90vh] w-full max-w-4xl" />
    </div>
  )

  return { button, panel, viewer }
}
