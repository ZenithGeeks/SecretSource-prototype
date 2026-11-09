/**
 * Labeler role: build the labeled dataset (claims, passages, 1-4 evidence labels) by hand.
 * `?analysis=` deep-links the paper being labeled; with none, the list of papers shows.
 */

import { ClipboardCheck, EyeOff, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useAsk } from '../../components/Ask'
import { SettingsModal } from '../../components/SettingsModal'
import type { Role } from '../../lib/roles'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { PaperBell } from './components/PaperBell'
import { BlindChecks } from './screens/BlindChecks'
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

export function LabelerApp({ onChangeRole, onSwitchRole }: { onChangeRole?: () => void; onSwitchRole?: (role: Role) => void }) {
  const [analysis, setAnalysis] = useState<string | null>(() => new URLSearchParams(window.location.search).get('analysis'))
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(window.location.search).get('tab') === 'blind' ? 'blind' : 'papers'))
  const [unsaved, setUnsaved] = useState(false) // the open workspace holds drafts that are not saved
  // A modal over the current screen, as in the other roles, so unsaved labels stay open under it.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const leave = (go: () => void) => () => {
    if (unsaved && !window.confirm('You have unsaved labels. Leave without saving?')) return
    go()
  }
  const openPaper = (id: string) => leave(() => setAnalysis(id))()
  usePaperNotices(openPaper)
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (analysis) params.set('analysis', analysis)
    else params.delete('analysis')
    if (screen === 'blind') params.set('tab', 'blind')
    else params.delete('tab')
    const query = params.toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }, [analysis, screen])

  return (
    <AppShell
      nav={NAV}
      active={screen}
      onNavigate={(next: Screen) =>
        leave(() => {
          setScreen(next)
          setAnalysis(null)
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
      breadcrumb={[TITLES[screen]]}
      toolbarLead={ask.button}
      panel={ask.panel}
      notifications={<PaperBell onOpen={openPaper} />}
    >
      {analysis ? (
        <Workspace
          analysisId={analysis}
          onDirtyChange={setUnsaved}
          askSlot={claimSlot}
          onOpenAsk={ask.showExtra}
          onBack={() => leave(() => setAnalysis(null))()}
          onOpenPaper={(id) => leave(() => setAnalysis(id))()}
        />
      ) : screen === 'blind' ? (
        <BlindChecks onOpen={setAnalysis} />
      ) : (
        <Queue onOpen={setAnalysis} onShowBlind={() => setScreen('blind')} />
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
