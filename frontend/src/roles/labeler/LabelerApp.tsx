/**
 * Labeler role: build the labeled dataset (claims, passages, 1-4 evidence labels) by hand.
 * `?analysis=` deep-links the paper being labeled; with none, the list of papers shows.
 */

import { ClipboardCheck, EyeOff, Tags } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Crumb, NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useAsk } from '../../components/Ask'
import { SettingsModal } from '../../components/SettingsModal'
import { usePool } from '../../lib/labeling'
import type { Role } from '../../lib/roles'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { PaperBell } from './components/PaperBell'
import { BlindChecks } from './screens/BlindChecks'
import { Labels } from './screens/Labels'
import { Queue } from './screens/Queue'
import { Workspace } from './screens/Workspace'
import { usePaperNotices } from './usePaperNotices'

type Screen = 'papers' | 'blind'

// Blind checks get their own tab, so a paper labeled blind is never mixed up with the main list (#867).
const NAV: NavEntry<Screen>[] = [
  { key: 'papers', label: 'Papers to label', icon: Tags },
  { key: 'blind', label: 'Blind checks', icon: EyeOff },
]
const TITLES: Record<Screen, string> = { papers: 'Papers to label', blind: 'Blind checks' }

/** The page the address names: an open paper, a paper's labels, or one of the two lists. */
function pageFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return {
    analysis: params.get('analysis'),
    labels: params.get('labels'),
    screen: (params.get('tab') === 'blind' ? 'blind' : 'papers') as Screen,
  }
}

/** Puts the page in the address. Another page is a new history entry, so Back returns to the one
 * before; the first sync only tidies the address the app opened with. */
function syncPageParams(analysis: string | null, labels: string | null, screen: Screen, keepHistory: boolean) {
  const params = new URLSearchParams(window.location.search)
  const shown = pageFromUrl()
  const newPage = keepHistory && (shown.analysis !== analysis || shown.labels !== labels || shown.screen !== screen)
  if (analysis) params.set('analysis', analysis)
  else params.delete('analysis')
  if (labels) params.set('labels', labels)
  else params.delete('labels')
  if (screen === 'blind') params.set('tab', 'blind')
  else params.delete('tab')
  const query = params.toString()
  const url = query ? `?${query}` : window.location.pathname
  if (newPage) window.history.pushState(null, '', url)
  // Keeps the list's scroll, saved in the entry's state.
  else window.history.replaceState(window.history.state, '', url)
}

/** How far the list is scrolled, kept in its history entry so Back returns to the same place. */
function rememberScroll() {
  window.history.replaceState({ ...window.history.state, labelerScroll: window.scrollY }, '')
}

export function LabelerApp({ onChangeRole, onSwitchRole }: { onChangeRole?: () => void; onSwitchRole?: (role: Role) => void }) {
  const [analysis, setAnalysis] = useState<string | null>(() => pageFromUrl().analysis)
  // A paper's labels, read-only (Labels). Set only while no paper is open in the workspace.
  const [labels, setLabels] = useState<string | null>(() => pageFromUrl().labels)
  const [screen, setScreen] = useState<Screen>(() => pageFromUrl().screen)
  const [unsaved, setUnsaved] = useState(false) // the open workspace holds drafts that are not saved
  // The paper Back was pressed on with unsaved labels: it stayed open and says why.
  const [backBlockedOn, setBackBlockedOn] = useState<string | null>(null)
  // The open paper is a blind check: Ask is off there, so its toolbar button goes too (#867).
  const [blind, setBlind] = useState(false)
  // A modal over the current screen, as in the other roles, so unsaved labels stay open under it.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const leave = (go: () => void) => () => {
    if (unsaved && !window.confirm('You have unsaved labels. Leave without saving?')) return
    go()
  }
  const openPaper = (id: string) =>
    leave(() => {
      rememberScroll()
      setLabels(null)
      setAnalysis(id)
    })()
  const fromList = (go: () => void) => {
    rememberScroll()
    go()
  }
  usePaperNotices(openPaper)
  // The open paper's title ends the breadcrumb, so the top bar names it and not only the list.
  // The list's name is text, not a button: the sidebar's own entry already goes back to it, and a
  // second one was a second Tab stop to the same place.
  const pool = usePool()
  const openTitle = pool.data?.papers.find((p) => p.analysis_id === (analysis ?? labels))?.title
  const breadcrumb: Crumb[] = openTitle ? [TITLES[screen], openTitle] : [TITLES[screen]]
  // Where the workspace draws its claim tools (review, questions about the paper and its
  // references) inside the Ask panel's "This claim" mode.
  const [claimSlot, setClaimSlot] = useState<HTMLDivElement | null>(null)
  const ask = useAsk({
    role: 'labeler',
    screen: analysis ? 'workspace' : 'papers',
    // No paper chip: a pool paper is often a teammate's, which the chat cannot read. Questions
    // about the open paper go through "This claim".
    canNarrow: false,
    // Do it with the Labeler's screen agent; the coding agent over MCP gets the same actions.
    // The workspace opens through open_paper, which needs a paper. It is a screen only once one is open.
    actions: {
      role: 'labeler',
      screen: analysis ? 'workspace' : 'papers',
      analysisId: analysis ?? undefined,
      screens: analysis ? ['papers', 'workspace'] : ['papers'],
      openScreen: (next) => {
        if (next === 'papers')
          leave(() => {
            setScreen('papers')
            setAnalysis(null)
          })()
      },
      openPaper,
      switchRole: onSwitchRole,
      confirmLeave: () => !unsaved || window.confirm('You have unsaved labels. Leave without saving?'),
    },
    extra: analysis ? { label: 'This claim', content: <div ref={setClaimSlot} /> } : undefined,
  })

  const synced = useRef(false)
  const shownUrl = useRef('')
  useEffect(() => {
    syncPageParams(analysis, labels, screen, synced.current)
    synced.current = true
    shownUrl.current = window.location.search
  }, [analysis, labels, screen])

  // Back and Forward show the page the address names, and the list where it was scrolled. With
  // unsaved labels the paper stays: its entry goes back on the stack and the page says why.
  useEffect(() => {
    const onPop = () => {
      const next = pageFromUrl()
      if (unsaved && next.analysis !== analysis) {
        window.history.pushState(null, '', shownUrl.current)
        setBackBlockedOn(analysis)
        return
      }
      const scroll = window.history.state?.labelerScroll
      setAnalysis(next.analysis)
      setLabels(next.labels)
      setScreen(next.screen)
      if (typeof scroll === 'number') requestAnimationFrame(() => window.scrollTo(0, scroll))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [unsaved, analysis])

  return (
    <AppShell
      nav={NAV}
      active={screen}
      onNavigate={(next: Screen) =>
        leave(() => {
          setScreen(next)
          setAnalysis(null)
          setLabels(null)
        })()
      }
      role="Labeler"
      roleIcon={ClipboardCheck}
      onChangeRole={onChangeRole && leave(onChangeRole)}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      // The workspace shows two PDFs and a label panel, so it takes the whole window.
      wide={analysis ? 'full' : true}
      foldable
      breadcrumb={breadcrumb}
      toolbarLead={!blind && ask.button}
      panel={!blind && ask.panel}
      notifications={<PaperBell onOpen={openPaper} />}
    >
      {unsaved && backBlockedOn === analysis && (
        <p role="alert" className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-ink">
          This paper has unsaved labels. Save them, or discard the change, before going back.
        </p>
      )}
      {analysis ? (
        <Workspace
          analysisId={analysis}
          onDirtyChange={setUnsaved}
          onBlindChange={setBlind}
          askSlot={claimSlot}
          onOpenAsk={ask.showExtra}
          onBack={() => leave(() => setAnalysis(null))()}
          onOpenPaper={(id) => leave(() => setAnalysis(id))()}
        />
      ) : labels ? (
        <Labels analysisId={labels} onBack={() => setLabels(null)} onLabel={() => openPaper(labels)} />
      ) : screen === 'blind' ? (
        <BlindChecks onOpen={(id) => fromList(() => setAnalysis(id))} />
      ) : (
        <Queue
          onOpen={(id) => fromList(() => setAnalysis(id))}
          onOpenLabels={(id) => fromList(() => setLabels(id))}
          onShowBlind={() => fromList(() => setScreen('blind'))}
        />
      )}
      {ask.viewer}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="labeler"
        onSwitchRole={onChangeRole ? leave(onChangeRole) : () => {}}
      />
    </AppShell>
  )
}
